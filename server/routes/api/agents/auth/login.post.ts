import { defineEventHandler, getRequestHeader, readBody, setCookie, setResponseStatus } from "h3";
import { AgentAuthError, authenticateAgent } from "../../../../services/agentAuthService";
import { getAgentPortalPath, isValidAgentPortalKey } from "../../../../services/agentPortal";

export default defineEventHandler(async (event) => {
  if (!getAgentPortalPath()) {
    setResponseStatus(event, 503);
    return { success: false, code: "AGENT_PORTAL_NOT_CONFIGURED", message: "بوابة الوكلاء غير مهيأة" };
  }
  if (!isValidAgentPortalKey(getRequestHeader(event, "x-agent-portal-key"))) {
    setResponseStatus(event, 404);
    return { success: false, code: "AGENT_PORTAL_NOT_FOUND", message: "الصفحة غير موجودة" };
  }

  const body = await readBody<{ username?: unknown; password?: unknown } | null>(event);
  if (
    !body ||
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    body.username.length > 128 ||
    body.password.length > 256
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_LOGIN_INPUT", message: "بيانات الدخول غير صالحة" };
  }

  try {
    const session = await authenticateAgent(body.username, body.password);
    setCookie(event, "wallet_agent_session", session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/agents",
      maxAge: 60 * 60 * 24,
    });
    return { success: true, agent: session.agent };
  } catch (error) {
    if (error instanceof AgentAuthError && error.code === "INVALID_AGENT_CREDENTIALS") {
      setResponseStatus(event, 401);
      return { success: false, code: error.code, message: error.message };
    }

    console.error("[Wallet Agent Login] Failed:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_LOGIN_FAILED", message: "تعذر تسجيل الدخول" };
  }
});
