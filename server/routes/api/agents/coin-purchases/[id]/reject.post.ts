import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  MemberCoinPurchaseError,
  rejectMemberCoinPurchase,
} from "../../../../../services/memberCoinPurchaseService";
import { requireWalletAgent } from "../../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };
  const body = await readBody<Record<string, unknown> | null>(event);
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "reason") ||
    typeof body.reason !== "string"
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_MEMBER_PURCHASE", message: "سبب الرفض مطلوب" };
  }

  try {
    const result = await rejectMemberCoinPurchase({
      purchaseId: getRouterParam(event, "id") || "",
      agentId: agent.id,
      reason: body.reason,
    });
    return { success: true, purchase: result };
  } catch (error) {
    if (error instanceof MemberCoinPurchaseError) {
      setResponseStatus(event, error.code === "INVALID_MEMBER_PURCHASE" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Purchases] Failed to reject member purchase:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_PURCHASE_REJECTION_FAILED", message: "تعذر رفض طلب الشراء" };
  }
});
