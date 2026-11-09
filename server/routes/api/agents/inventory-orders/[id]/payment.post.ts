import { randomUUID } from "node:crypto";
import {
  assertBodySize,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { dbPool } from "../../../../../db";
import {
  AgentInventoryError,
  submitAgentInventoryOrderPayment,
} from "../../../../../services/agentInventoryService";
import {
  deletePrivateReceipt,
  inspectReceiptImage,
  MAX_RECEIPT_BYTES,
  uploadPrivateReceipt,
} from "../../../../../services/privateReceiptStore";
import { requireWalletAgent } from "../../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };

  const orderId = getRouterParam(event, "id") || "";
  let uploadedKey = "";
  try {
    await assertBodySize(event, MAX_RECEIPT_BYTES + 32 * 1024);
    const formData = await event.req.formData();
    const formKeys = [...formData.keys()];
    if (
      formKeys.length !== 2 ||
      formKeys.filter((key) => key === "receipt").length !== 1 ||
      formKeys.filter((key) => key === "paymentReference").length !== 1
    ) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_INVENTORY_PAYMENT", message: "بيانات إثبات الدفع غير صالحة" };
    }
    const paymentReference = formData.get("paymentReference");
    const receipt = formData.get("receipt");
    if (
      typeof paymentReference !== "string" ||
      !(receipt instanceof File) ||
      receipt.size < 1 ||
      receipt.size > MAX_RECEIPT_BYTES
    ) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_INVENTORY_PAYMENT", message: "أرفق صورة إيصال صالحة ومرجع التحويل" };
    }
    const buffer = Buffer.from(await receipt.arrayBuffer());
    const image = inspectReceiptImage(buffer);
    if (!image || receipt.type !== image.contentType) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_RECEIPT_IMAGE", message: "نوع أو محتوى صورة الإيصال غير مدعوم" };
    }

    const ownerCheck = await dbPool.query(
      `SELECT 1 FROM "wallet_agent_inventory_orders" WHERE "id" = $1 AND "agent_id" = $2 LIMIT 1`,
      [orderId, agent.id],
    );
    if (ownerCheck.rows.length !== 1) {
      setResponseStatus(event, 404);
      return { success: false, code: "INVENTORY_ORDER_NOT_FOUND", message: "طلب المخزون غير موجود" };
    }

    uploadedKey = `wallet-proofs/${randomUUID()}.${image.extension}`;
    await uploadPrivateReceipt(uploadedKey, buffer, image.contentType);
    const result = await submitAgentInventoryOrderPayment({
      orderId,
      agentId: agent.id,
      paymentReference,
      proofObjectKey: uploadedKey,
    });
    return { success: true, order: result };
  } catch (error) {
    if (uploadedKey && error instanceof AgentInventoryError) {
      try {
        await deletePrivateReceipt(uploadedKey);
      } catch (cleanupError) {
        console.error("[Agent Inventory] Orphaned receipt cleanup failed:", cleanupError);
      }
    }
    if (error instanceof AgentInventoryError) {
      setResponseStatus(event, error.code === "INVALID_INVENTORY_PAYMENT" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Agent Inventory] Failed to submit payment proof:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "INVENTORY_PAYMENT_SUBMISSION_FAILED", message: "تعذر إرسال إثبات الدفع" };
  }
});
