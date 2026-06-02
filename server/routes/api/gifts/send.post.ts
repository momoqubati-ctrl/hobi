import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { sendGift } from "../../../services/giftService";
import { createNotification } from "../../../services/notificationService";
import { dbPool } from "../../../db";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { senderId, receiverId, giftId, quantity } = body;

  if (!senderId || !giftId) {
    setResponseStatus(event, 400);
    return { success: false, message: "senderId و giftId مطلوبان" };
  }

  try {
    const result = await sendGift(senderId, receiverId || null, giftId, quantity || 1);

    if (receiverId) {
      try {
        const giftRes = await dbPool.query(
          "SELECT name, icon FROM gift_catalog WHERE id = $1 LIMIT 1",
          [giftId],
        );
        const giftName = giftRes.rows[0]?.name || "هدية";
        const giftIcon = giftRes.rows[0]?.icon || "🎁";
        await createNotification(receiverId, senderId, "gift", "gift", giftId, {
          giftName,
          giftIcon,
          quantity: quantity || 1,
        }).catch(() => {});
      } catch (_) {}
    }

    return { success: true, ...result };
  } catch (error: any) {
    const message = error.message || "تعذر إرسال الهدية";
    if (message.includes("غير موجود") || message.includes("رصيد غير كافٍ")) {
      setResponseStatus(event, 400);
    } else {
      setResponseStatus(event, 500);
    }
    return { success: false, message };
  }
});
