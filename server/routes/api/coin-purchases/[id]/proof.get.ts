import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { dbPool } from "../../../../db";
import { getPrivateReceiptContentType, readPrivateReceipt } from "../../../../services/privateReceiptStore";
import { requireCoinPurchaseMember } from "../../../../services/memberPurchaseAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Content-Security-Policy", "default-src 'none'; sandbox");
  const member = await requireCoinPurchaseMember(event);
  if (!member.ok) return { success: false, code: "MEMBER_ACCESS_DENIED", message: member.message };

  try {
    const result = await dbPool.query<{ proof_object_key: string }>(
      `SELECT "proof_object_key"
       FROM "member_coin_purchases"
       WHERE "id" = $1 AND "member_user_id" = $2 AND "proof_object_key" IS NOT NULL
         AND "receipt_expires_at" > now()
       LIMIT 1`,
      [getRouterParam(event, "id") || "", member.id],
    );
    const key = result.rows[0]?.proof_object_key;
    if (!key) {
      setResponseStatus(event, 404);
      return { success: false, code: "RECEIPT_NOT_FOUND", message: "الإيصال غير موجود أو انتهت مدة الاحتفاظ به" };
    }
    setResponseHeader(event, "Content-Type", getPrivateReceiptContentType(key));
    setResponseHeader(event, "Content-Disposition", "inline");
    return await readPrivateReceipt(key);
  } catch (error) {
    console.error("[Coin Purchases] Failed to read member receipt:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "RECEIPT_READ_FAILED", message: "تعذر تحميل الإيصال" };
  }
});
