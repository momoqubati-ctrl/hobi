import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { AgentAuthError, changeAgentPassword } from "../../../../services/agentAuthService";
import { requireWalletAgent } from "../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  const agent = await requireWalletAgent(event, true);
  if (!agent.ok) return { success: false, message: agent.message };

  const body = await readBody<{
    currentPassword?: unknown;
    newPassword?: unknown;
  } | null>(event);
  if (
    !body ||
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string"
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_PASSWORD_INPUT", message: "بيانات كلمة المرور غير صالحة" };
  }

  try {
    await changeAgentPassword(agent.id, body.currentPassword, body.newPassword);
    return { success: true };
  } catch (error) {
    if (error instanceof AgentAuthError) {
      setResponseStatus(event, error.code === "INVALID_AGENT_CREDENTIALS" ? 401 : 422);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Wallet Agent Password] Update failed:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "PASSWORD_UPDATE_FAILED", message: "تعذر تغيير كلمة المرور" };
  }
});
