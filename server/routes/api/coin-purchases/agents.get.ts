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
      `SELECT agents."id" AS "agentId", agents."username" AS "agentUsername",
              agents."name" AS "agentName", packages."id" AS "packageId",
              packages."coin_amount"::text AS "coinAmount",
              packages."price_minor_units"::text AS "priceMinorUnits",
              packages."currency_code" AS "currencyCode",
              packages."payment_instructions" AS "paymentInstructions"
       FROM "wallet_agents" agents
       JOIN "wallet_agent_packages" packages ON packages."agent_id" = agents."id"
       WHERE agents."status" = 'active' AND packages."is_active" = true
       ORDER BY agents."name", packages."coin_amount"`,
    );
    return { success: true, packages: result.rows };
  } catch (error) {
    console.error("[Coin Purchases] Failed to list public agent packages:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "COIN_PURCHASE_PACKAGES_FAILED", message: "تعذر تحميل باقات الشراء" };
  }
});
