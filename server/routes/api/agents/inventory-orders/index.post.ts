import {
  defineEventHandler,
  getRequestHeader,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { createAgentInventoryOrder, AgentInventoryError } from "../../../../services/agentInventoryService";
import { requireWalletAgent } from "../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };

  const body = await readBody<Record<string, unknown> | null>(event);
  const idempotencyKey = getRequestHeader(event, "idempotency-key");
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "requestedCoins") ||
    typeof body.requestedCoins !== "number" ||
    !Number.isSafeInteger(body.requestedCoins) ||
    !idempotencyKey
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_INVENTORY_ORDER", message: "كمية الشحن ومفتاح الطلب مطلوبان" };
  }

  try {
    const result = await createAgentInventoryOrder({
      agentId: agent.id,
      requestedCoins: body.requestedCoins,
      idempotencyKey,
    });
    return { success: true, order: result };
  } catch (error) {
    if (error instanceof AgentInventoryError) {
      setResponseStatus(event, error.code === "INVALID_INVENTORY_ORDER" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Inventory] Failed to create stock request:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_INVENTORY_REQUEST_FAILED", message: "تعذر إنشاء طلب المخزون" };
  }
});
