import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { AgentAuthError, provisionWalletAgent } from "../../../services/agentAuthService";
import { guardAdminAction } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  const admin = await guardAdminAction(event, "admin_agentwallets");
  const body = await readBody<{ username?: unknown; name?: unknown; phone?: unknown } | null>(event);

  if (
    !body ||
    typeof body.username !== "string" ||
    typeof body.name !== "string" ||
    (body.phone !== undefined && typeof body.phone !== "string") ||
    body.username.length > 128 ||
    body.name.length > 120 ||
    (typeof body.phone === "string" && body.phone.length > 32)
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_AGENT_INPUT", message: "بيانات الوكيل غير صالحة" };
  }

  try {
    const agent = await provisionWalletAgent(
      {
        username: body.username,
        name: body.name,
        phone: typeof body.phone === "string" ? body.phone : "",
      },
      admin.userId,
    );
    return { success: true, agent };
  } catch (error) {
    if (error instanceof AgentAuthError) {
      setResponseStatus(event, 422);
      return { success: false, code: error.code, message: error.message };
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      setResponseStatus(event, 409);
      return { success: false, code: "AGENT_USERNAME_EXISTS", message: "اسم المستخدم مستخدم بالفعل" };
    }
    console.error("[Admin Wallet Agents] Create failed:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_CREATE_FAILED", message: "تعذر إنشاء حساب الوكيل" };
  }
});
