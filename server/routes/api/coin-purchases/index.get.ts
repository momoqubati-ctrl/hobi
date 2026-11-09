import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { requireCoinPurchaseMember } from "../../../services/memberPurchaseAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const member = await requireCoinPurchaseMember(event);
  if (!member.ok) return { success: false, code: "MEMBER_ACCESS_DENIED", message: member.message };
  try {
    const result = await dbPool.query(
      `SELECT purchases."id", purchases."agent_id" AS "agentId",
              agents."name" AS "agentName", purchases."coin_amount"::text AS "coinAmount",
              purchases."price_minor_units"::text AS "priceMinorUnits",
              purchases."currency_code" AS "currencyCode",
              purchases."payment_instructions_snapshot" AS "paymentInstructions",
              purchases."payment_reference" AS "paymentReference",
              purchases."status", purchases."rejection_reason" AS "rejectionReason",
              purchases."created_at" AS "createdAt"
       FROM "member_coin_purchases" purchases
       JOIN "wallet_agents" agents ON agents."id" = purchases."agent_id"
       WHERE purchases."member_user_id" = $1
       ORDER BY purchases."created_at" DESC
       LIMIT 100`,
      [member.id],
    );
    return { success: true, purchases: result.rows };
  } catch (error) {
    console.error("[Coin Purchases] Failed to load member purchases:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "COIN_PURCHASE_HISTORY_FAILED", message: "تعذر تحميل سجل الشراء" };
  }
});
