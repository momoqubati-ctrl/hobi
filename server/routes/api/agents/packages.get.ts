import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { listAgentPackages, AgentPackageError } from "../../../services/agentPackageService";
import { requireWalletAgent } from "../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };
  try {
    return { success: true, packages: await listAgentPackages(agent.id) };
  } catch (error) {
    if (error instanceof AgentPackageError) {
      setResponseStatus(event, 422);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Packages] Failed to list packages:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_PACKAGE_LIST_FAILED", message: "تعذر تحميل باقات العملات" };
  }
});
