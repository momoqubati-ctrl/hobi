import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  AgentInventoryError,
  approveAgentInventoryOrder,
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
    Object.keys(body).length !== 1 ||
    body.paymentVerified !== true
  ) {
    setResponseStatus(event, 422);
    return {
      success: false,
      code: "PAYMENT_NOT_VERIFIED",
      message: "أكد التحقق من التحويل قبل اعتماد مخزون الوكيل",
    };
  }

  try {
    const result = await approveAgentInventoryOrder({
      orderId: getRouterParam(event, "id") || "",
      siteOwnerUserId: owner.id,
      paymentVerified: body.paymentVerified,
    });
    return { success: true, settlement: result };
  } catch (error) {
    if (error instanceof AgentInventoryError) {
      const status = error.code === "LEDGER_ACCOUNT_NOT_INITIALIZED" ? 503
        : error.code === "LEDGER_INCONSISTENT" ? 500 : 409;
      setResponseStatus(event, status);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Site Owner Inventory] Failed to approve stock request:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "SITE_OWNER_INVENTORY_APPROVAL_FAILED", message: "تعذر اعتماد طلب المخزون" };
  }
});
