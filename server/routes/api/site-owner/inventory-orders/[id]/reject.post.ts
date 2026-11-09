import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  AgentInventoryError,
  rejectAgentInventoryOrder,
} from "../../../../../services/agentInventoryService";
import { requireSiteOwner } from "../../../../../services/siteOwnerAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  const owner = await requireSiteOwner(event);
  if (!owner.ok) {
    return { success: false, code: "SITE_OWNER_ACCESS_DENIED", message: owner.message };
  }

  const body = await readBody<Record<string, unknown> | null>(event);
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "reason") ||
    typeof body.reason !== "string"
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_INVENTORY_ORDER", message: "سبب الرفض مطلوب" };
  }

  try {
    const result = await rejectAgentInventoryOrder({
      orderId: getRouterParam(event, "id") || "",
      siteOwnerUserId: owner.id,
      reason: body.reason,
    });
    return { success: true, order: result };
  } catch (error) {
    if (error instanceof AgentInventoryError) {
      setResponseStatus(event, error.code === "INVALID_INVENTORY_ORDER" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Site Owner Inventory] Failed to reject stock request:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "SITE_OWNER_INVENTORY_REJECTION_FAILED", message: "تعذر رفض طلب المخزون" };
  }
});
