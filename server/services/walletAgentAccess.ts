import { getCookie, getRequestHeader, H3Event, setResponseStatus } from "h3";
import { dbPool } from "../db";
import { getAgentPortalPath, isValidAgentPortalKey } from "./agentPortal";
import { verifyAuthToken } from "./authService";

export const getWalletAgentContext = async (event: H3Event) => {
  if (!getAgentPortalPath()) {
    setResponseStatus(event, 503);
    return { ok: false as const, statusCode: 503, message: "بوابة الوكلاء غير مهيأة" };
  }
  if (!isValidAgentPortalKey(getRequestHeader(event, "x-agent-portal-key"))) {
    setResponseStatus(event, 404);
    return { ok: false as const, statusCode: 404, message: "الصفحة غير موجودة" };
  }

  const authorization = getRequestHeader(event, "authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : getCookie(event, "wallet_agent_session") || "";
  const claims = verifyAuthToken(token);
  if (!claims || claims.role !== "agent" || claims.type !== "wallet_agent") {
    return { ok: false as const, statusCode: 401, message: "جلسة الوكيل غير صالحة" };
  }

  const result = await dbPool.query<{
    id: string;
    username: string;
    name: string;
    phone: string;
    force_password_change: boolean;
  }>(
    `SELECT "id"::text AS "id", "username", "name", "phone", "force_password_change"
     FROM "wallet_agents"
     WHERE "id" = $1 AND "status" = 'active'
     LIMIT 1`,
    [claims.sub],
  );
  const agent = result.rows[0];
  if (!agent) {
    return { ok: false as const, statusCode: 403, message: "حساب الوكيل غير نشط" };
  }

  return {
    ok: true as const,
    ...agent,
  };
};

export const requireWalletAgent = async (event: H3Event, allowPasswordChange = false) => {
  const agent = await getWalletAgentContext(event);
  if (!agent.ok) {
    setResponseStatus(event, agent.statusCode);
    return agent;
  }
  if (agent.force_password_change && !allowPasswordChange) {
    setResponseStatus(event, 403);
    return {
      ok: false as const,
      statusCode: 403,
      message: "يجب تغيير كلمة المرور المؤقتة قبل متابعة استخدام الحساب",
    };
  }
  return agent;
};
