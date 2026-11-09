import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  AgentInventoryError,
  quoteAgentInventoryOrder,
} from "../../../../../services/agentInventoryService";
import { requireSiteOwner } from "../../../../../services/siteOwnerAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const owner = await requireSiteOwner(event);
  if (!owner.ok) {
    return { success: false, code: "SITE_OWNER_ACCESS_DENIED", message: owner.message };
  }

  const orderId = getRouterParam(event, "id") || "";
  const body = await readBody<Record<string, unknown> | null>(event);
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) =>
      !["priceMinorUnits", "currencyCode", "paymentInstructions"].includes(key),
    ) ||
    typeof body.priceMinorUnits !== "number" ||
    typeof body.currencyCode !== "string" ||
    typeof body.paymentInstructions !== "string"
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_INVENTORY_QUOTE", message: "بيانات عرض السعر غير صالحة" };
  }

  try {
    const result = await quoteAgentInventoryOrder({
      orderId,
      siteOwnerUserId: owner.id,
      priceMinorUnits: body.priceMinorUnits,
      currencyCode: body.currencyCode,
      paymentInstructions: body.paymentInstructions,
    });
    return { success: true, order: result };
  } catch (error) {
    if (error instanceof AgentInventoryError) {
      setResponseStatus(event, error.code === "INVALID_INVENTORY_QUOTE" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Site Owner Inventory] Failed to quote stock request:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "SITE_OWNER_INVENTORY_QUOTE_FAILED", message: "تعذر تسعير طلب المخزون" };
  }
});
