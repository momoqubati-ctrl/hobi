import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  approveMemberCoinPurchase,
  MemberCoinPurchaseError,
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
    Object.keys(body).length !== 1 ||
    body.paymentVerified !== true
  ) {
    setResponseStatus(event, 422);
    return {
      success: false,
      code: "PAYMENT_NOT_VERIFIED",
      message: "أكد التحقق من التحويل قبل اعتماد رصيد العضو",
    };
  }
  try {
    const result = await approveMemberCoinPurchase({
      purchaseId: getRouterParam(event, "id") || "",
      agentId: agent.id,
      paymentVerified: body.paymentVerified,
    });
    return { success: true, settlement: result };
  } catch (error) {
    if (error instanceof MemberCoinPurchaseError) {
      const status = error.code === "LEDGER_ACCOUNT_NOT_INITIALIZED" ? 503
        : error.code === "LEDGER_INCONSISTENT" ? 500 : 409;
      setResponseStatus(event, status);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Purchases] Failed to approve member purchase:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_PURCHASE_APPROVAL_FAILED", message: "تعذر اعتماد طلب الشراء" };
  }
});
