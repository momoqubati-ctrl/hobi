import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { sendPrivateMessage } from "../../../services/privateMessageService";
import { createNotification } from "../../../services/notificationService";
import { publishGlobalEvent, publishSocketEvent } from "../../../socket/SocketBroker";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { senderId, receiverId, text, clientId } = body;

  if (!senderId || !receiverId || !text?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "senderId, receiverId, text مطلوبون" };
  }

  try {
    const { dbPool } = await import("../../../db");
    const userRes = await dbPool.query(
      `SELECT u.muted as legacy_muted, up.muted as profile_muted 
       FROM users u
       LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
       WHERE CAST(u.uid AS text) = $1 OR CAST(u.id AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($1) 
       LIMIT 1`,
      [senderId],
    );
    const dbUser = userRes.rows[0];
    const isMuted = dbUser ? (Boolean(dbUser.profile_muted) || Boolean(dbUser.legacy_muted && dbUser.legacy_muted !== 0 && dbUser.legacy_muted !== "0")) : false;
    if (isMuted) {
      setResponseStatus(event, 403);
      return { success: false, message: "تم منعك من الحديث في الدردشة" };
    }

    const message = await sendPrivateMessage(senderId, receiverId, text);
    const socketMessage = {
      ...message,
      clientId: typeof clientId === "string" ? clientId : undefined,
      text: message.body,
      read: Boolean(message.readAt),
    };
    // المعرّفات في message موحّدة إلى uid (نصّي) لتطابق localStorage

    // بث الرسالة لكل المتصلين (فلترة من جهة العميل عبر receiverId / senderId)
    await publishGlobalEvent("pm:message", socketMessage).catch((err) => {
      console.error("[PM] publishGlobalEvent error:", err);
    });

    // بث موجّه إلى غرفتي الاجتماعية والاجتماعية للمرسل (تحديث حالة الشارات عند المستقبل والمرسل)
    await Promise.all([
      publishSocketEvent(`social:${message.receiverId}`, "pm:message", socketMessage).catch((err) => {
        console.error("[PM] publishSocketEvent receiver error:", err);
      }),
      publishSocketEvent(`social:${message.senderId}`, "pm:message", socketMessage).catch((err) => {
        console.error("[PM] publishSocketEvent sender error:", err);
      }),
    ]);

    if (String(senderId) !== String(receiverId)) {
      // نُمرّر message.receiverId (الموحّد) ليتطابق مع user_id في جدول notifications
      createNotification(message.receiverId, message.senderId, "mail", "private_message", message.id, {
        preview: text.slice(0, 100),
      }).catch((err) => {
        console.error("[PM] createNotification error:", err);
      });
    }

    return { success: true, message: socketMessage };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message || "تعذر إرسال الرسالة" };
  }
});
