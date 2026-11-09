import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { requireSiteOwner } from "../../../../services/siteOwnerAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const owner = await requireSiteOwner(event);
  if (!owner.ok) {
    return { success: false, code: "SITE_OWNER_ACCESS_DENIED", message: owner.message };
  }

  try {
    const result = await dbPool.query(
      `SELECT orders."id", orders."agent_id" AS "agentId",
              agents."username" AS "agentUsername", agents."name" AS "agentName",
              orders."requested_coins"::text AS "requestedCoins",
              orders."quoted_price_minor_units"::text AS "quotedPriceMinorUnits",
              orders."currency_code" AS "currencyCode",
              orders."payment_instructions_snapshot" AS "paymentInstructions",
              orders."payment_reference" AS "paymentReference",
              orders."status", orders."rejection_reason" AS "rejectionReason",
              orders."proof_object_key" IS NOT NULL AS "hasReceipt",
              orders."created_at" AS "createdAt", orders."updated_at" AS "updatedAt"
       FROM "wallet_agent_inventory_orders" orders
       JOIN "wallet_agents" agents ON agents."id" = orders."agent_id"
       ORDER BY orders."created_at" DESC
       LIMIT 100`,
    );
    return { success: true, orders: result.rows };
  } catch (error) {
    console.error("[Site Owner Inventory] Failed to list stock requests:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "SITE_OWNER_INVENTORY_LIST_FAILED", message: "تعذر تحميل طلبات المخزون" };
  }
});
