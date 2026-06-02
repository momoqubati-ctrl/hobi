import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { sendPrivateMessage } from "../../../services/privateMessageService";
import { createNotification } from "../../../services/notificationService";
import { publishGlobalEvent, publishSocketEvent } from "../../../socket/SocketBroker";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { senderId, receiverId, text } = body;

  if (!senderId || !receiverId || !text?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "senderId, receiverId, text مطلوبون" };
  }

  try {
    const message = await sendPrivateMessage(senderId, receiverId, text);
    // المعرّفات في message موحّدة إلى uid (نصّي) لتطابق localStorage

    // بث الرسالة لكل المتصلين (فلترة من جهة العميل عبر receiverId / senderId)
    await publishGlobalEvent("private_message", message).catch((err) => {
      console.error("[PM] publishGlobalEvent error:", err);
    });

    // بث موجّه إلى غرفتي الاجتماعية والاجتماعية للمرسل (تحديث حالة الشارات عند المستقبل والمرسل)
    await Promise.all([
      publishSocketEvent(`social:${message.receiverId}`, "private_message", message).catch((err) => {
        console.error("[PM] publishSocketEvent receiver error:", err);
      }),
      publishSocketEvent(`social:${message.senderId}`, "private_message", message).catch((err) => {
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

    return { success: true, message };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message || "تعذر إرسال الرسالة" };
  }
});
