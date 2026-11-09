import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { requireWalletAgent } from "../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };

  try {
    const result = await dbPool.query(
      `SELECT "id", "requested_coins"::text AS "requestedCoins",
              "quoted_price_minor_units"::text AS "quotedPriceMinorUnits",
              "currency_code" AS "currencyCode",
              "payment_instructions_snapshot" AS "paymentInstructions",
              "payment_reference" AS "paymentReference", "status",
              "rejection_reason" AS "rejectionReason", "created_at" AS "createdAt",
              "updated_at" AS "updatedAt"
       FROM "wallet_agent_inventory_orders"
       WHERE "agent_id" = $1
       ORDER BY "created_at" DESC
       LIMIT 100`,
      [agent.id],
    );
    return { success: true, orders: result.rows };
  } catch (error) {
    console.error("[Agent Inventory] Failed to list stock requests:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "AGENT_INVENTORY_LIST_FAILED", message: "تعذر تحميل طلبات المخزون" };
  }
});
