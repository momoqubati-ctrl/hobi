import { randomUUID } from "node:crypto";
import {
  assertBodySize,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { dbPool } from "../../../../db";
import {
  MemberCoinPurchaseError,
  submitMemberCoinPurchasePayment,
} from "../../../../services/memberCoinPurchaseService";
import {
  deletePrivateReceipt,
  inspectReceiptImage,
  MAX_RECEIPT_BYTES,
  uploadPrivateReceipt,
} from "../../../../services/privateReceiptStore";
import { requireCoinPurchaseMember } from "../../../../services/memberPurchaseAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const member = await requireCoinPurchaseMember(event);
  if (!member.ok) return { success: false, code: "MEMBER_ACCESS_DENIED", message: member.message };
  await assertBodySize(event, MAX_RECEIPT_BYTES + 32 * 1024);

  const purchaseId = getRouterParam(event, "id") || "";
  let uploadedKey = "";
  try {
    const formData = await event.req.formData();
    const formKeys = [...formData.keys()];
    if (
      formKeys.length !== 2 ||
      formKeys.filter((key) => key === "receipt").length !== 1 ||
      formKeys.filter((key) => key === "paymentReference").length !== 1
    ) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_MEMBER_PAYMENT", message: "بيانات إثبات الدفع غير صالحة" };
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
      return { success: false, code: "INVALID_MEMBER_PAYMENT", message: "أرفق صورة إيصال صالحة ومرجع التحويل" };
    }
    const buffer = Buffer.from(await receipt.arrayBuffer());
    const image = inspectReceiptImage(buffer);
    if (!image || receipt.type !== image.contentType) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_RECEIPT_IMAGE", message: "نوع أو محتوى صورة الإيصال غير مدعوم" };
    }

    const purchaseCheck = await dbPool.query(
      `SELECT 1 FROM "member_coin_purchases"
       WHERE "id" = $1 AND "member_user_id" = $2 AND "status" = 'awaiting_payment'
       LIMIT 1`,
      [purchaseId, member.id],
    );
    if (purchaseCheck.rows.length !== 1) {
      setResponseStatus(event, 404);
      return { success: false, code: "MEMBER_PURCHASE_NOT_FOUND", message: "طلب الشراء غير موجود" };
    }

    uploadedKey = `wallet-proofs/${randomUUID()}.${image.extension}`;
    await uploadPrivateReceipt(uploadedKey, buffer, image.contentType);
    const result = await submitMemberCoinPurchasePayment({
      purchaseId,
      memberUserId: member.id,
      paymentReference,
      proofObjectKey: uploadedKey,
    });
    return { success: true, purchase: result };
  } catch (error) {
    if (uploadedKey && error instanceof MemberCoinPurchaseError) {
      try {
        await deletePrivateReceipt(uploadedKey);
      } catch (cleanupError) {
        console.error("[Coin Purchases] Orphaned receipt cleanup failed:", cleanupError);
      }
    }
    if (error instanceof MemberCoinPurchaseError) {
      setResponseStatus(event, error.code === "INVALID_MEMBER_PAYMENT" ? 422 : 409);
      return { success: false, code: error.code, message: error.message };
    }
    console.error("[Coin Purchases] Failed to submit member receipt:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "MEMBER_PAYMENT_SUBMISSION_FAILED", message: "تعذر إرسال إثبات الدفع" };
  }
});
