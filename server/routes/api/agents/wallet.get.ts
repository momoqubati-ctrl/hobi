import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { AgentInventoryError, getAgentInventoryBalance } from "../../../services/agentInventoryService";
import { requireWalletAgent } from "../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };

  try {
    return { success: true, balanceCoins: await getAgentInventoryBalance(agent.id) };
  } catch (error) {
    if (error instanceof AgentInventoryError) {
      setResponseStatus(event, 500);
      return { success: false, code: error.code, message: "تعذر تحميل رصيد الوكيل" };
    }
    console.error("[Agent Wallet] Failed to load inventory balance:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_WALLET_READ_FAILED", message: "تعذر تحميل رصيد الوكيل" };
  }
});
