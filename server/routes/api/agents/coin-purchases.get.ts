import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { requireWalletAgent } from "../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };
  try {
    const result = await dbPool.query(
      `SELECT purchases."id", purchases."member_user_id" AS "memberUserId",
              members."username" AS "memberUsername",
              purchases."coin_amount"::text AS "coinAmount",
              purchases."price_minor_units"::text AS "priceMinorUnits",
              purchases."currency_code" AS "currencyCode",
              purchases."payment_instructions_snapshot" AS "paymentInstructions",
              purchases."payment_reference" AS "paymentReference",
              purchases."status", purchases."rejection_reason" AS "rejectionReason",
              purchases."proof_object_key" IS NOT NULL AS "hasReceipt",
              purchases."created_at" AS "createdAt"
       FROM "member_coin_purchases" purchases
       JOIN "users" members ON members."id" = purchases."member_user_id"
       WHERE purchases."agent_id" = $1
       ORDER BY purchases."created_at" DESC
       LIMIT 100`,
      [agent.id],
    );
    return { success: true, purchases: result.rows };
  } catch (error) {
    console.error("[Agent Purchases] Failed to list member orders:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_PURCHASE_LIST_FAILED", message: "تعذر تحميل طلبات شراء الأعضاء" };
  }
});
