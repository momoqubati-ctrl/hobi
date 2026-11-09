import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { GiftLedgerError, sendGiftFromWallet } from "../../../services/coinLedgerService";
import { getUserAuthContext } from "../../../services/adminAccess";
import { createNotification } from "../../../services/notificationService";
import { dbPool } from "../../../db";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId || auth.role.toLowerCase() === "guest") {
    setResponseStatus(event, auth.ok ? 403 : 401);
    return { success: false, message: auth.ok ? "إرسال الهدايا متاح للأعضاء فقط" : auth.message };
  }

  const body = await readBody<{
    receiverId?: unknown;
    giftId?: unknown;
    quantity?: unknown;
  } | null>(event);
  const idempotencyKey = getHeader(event, "idempotency-key");
  if (
    !body ||
    typeof body.receiverId !== "string" ||
    typeof body.giftId !== "string" ||
    typeof body.quantity !== "number" ||
    !idempotencyKey
  ) {
    setResponseStatus(event, 422);
    return { success: false, message: "بيانات الهدية ومفتاح العملية مطلوبة" };
  }

  try {
    const result = await sendGiftFromWallet({
      senderUserId: auth.userId,
      receiverUserId: body.receiverId,
      giftId: body.giftId,
      quantity: body.quantity,
      idempotencyKey,
    });

    if (!result.replayed) {
      try {
        const giftRes = await dbPool.query(
          "SELECT name, icon FROM gift_catalog WHERE id = $1 LIMIT 1",
          [body.giftId],
        );
        const giftName = giftRes.rows[0]?.name || "هدية";
        const giftIcon = giftRes.rows[0]?.icon || "🎁";
        await createNotification(body.receiverId, auth.userId, "gift", "gift", body.giftId, {
          giftName,
          giftIcon,
          quantity: body.quantity,
        });
      } catch (notificationError) {
        console.error("Failed to notify recipient about a committed gift", notificationError);
      }
    }

    return {
      success: true,
      id: result.id,
      totalCoins: result.totalCoins,
      newBalance: result.newBalance,
      createdAt: result.createdAt,
    };
  } catch (error) {
    if (error instanceof GiftLedgerError) {
      const status = error.code === "GIFT_NOT_FOUND"
        ? 404
        : error.code === "INVALID_GIFT" || error.code === "INVALID_GIFT_PRICE"
          ? 422
          : error.code === "WALLET_CUTOVER_PENDING" || error.code === "COMMISSION_NOT_CONFIGURED"
            ? 503
            : error.code === "LEDGER_INCONSISTENT"
              ? 500
              : 409;
      setResponseStatus(event, status);
      return { success: false, code: error.code, message: error.message };
    }

    console.error("Gift ledger operation failed", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر إرسال الهدية" };
  }
});
