import {
  defineEventHandler,
  getRequestHeader,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { createMemberCoinPurchase, MemberCoinPurchaseError } from "../../../services/memberCoinPurchaseService";
import { requireCoinPurchaseMember } from "../../../services/memberPurchaseAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const member = await requireCoinPurchaseMember(event);
  if (!member.ok) return { success: false, code: "MEMBER_ACCESS_DENIED", message: member.message };
  const body = await readBody<Record<string, unknown> | null>(event);
  const idempotencyKey = getRequestHeader(event, "idempotency-key");
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "agentId" && key !== "packageId") ||
    typeof body.agentId !== "string" ||
    typeof body.packageId !== "string" ||
    !idempotencyKey
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_MEMBER_PURCHASE", message: "اختر باقة وأعد المحاولة" };
  }

  try {
    const result = await createMemberCoinPurchase({
      memberUserId: member.id,
      agentId: body.agentId,
      packageId: body.packageId,
      idempotencyKey,
    });
    return {
      success: true,
      purchase: {
        id: result.id,
        agentId: result.agent_id,
        coinAmount: result.coin_amount,
        priceMinorUnits: result.price_minor_units,
        currencyCode: result.currency_code,
        paymentInstructions: result.payment_instructions_snapshot,
        status: result.status,
        replayed: result.replayed,
      },
    };
  } catch (error) {
    if (error instanceof MemberCoinPurchaseError) {
      setResponseStatus(
        event,
        error.code === "INVALID_MEMBER_PURCHASE" ? 422
          : error.code === "PACKAGE_UNAVAILABLE" ? 404 : 409,
      );
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Coin Purchases] Failed to create purchase request:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "COIN_PURCHASE_CREATE_FAILED", message: "تعذر إنشاء طلب الشراء" };
  }
});
