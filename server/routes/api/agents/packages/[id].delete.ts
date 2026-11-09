import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from "h3";
import {
  AgentPackageError,
  setAgentPackageActive,
} from "../../../../services/agentPackageService";
import { requireWalletAgent } from "../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };
  try {
    return {
      success: true,
      package: await setAgentPackageActive(agent.id, getRouterParam(event, "id") || "", false),
    };
  } catch (error) {
    if (error instanceof AgentPackageError) {
      setResponseStatus(event, error.code === "INVALID_AGENT_PACKAGE" ? 422 : 404);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Packages] Failed to deactivate package:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_PACKAGE_UPDATE_FAILED", message: "تعذر إيقاف باقة العملات" };
  }
});
