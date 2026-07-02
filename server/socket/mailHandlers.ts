import type { Server, Socket } from "socket.io";
import { sendMail, getInbox, getOutbox, markAsRead, deleteMail, getUnreadCount } from "../services/internalMailService";
import { createNotification } from "../services/notificationService";
import { publishGlobalEvent } from "./SocketBroker";

export function registerMailHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user;

  /**
   * إرسال بريد داخلي
   */
  socket.on("mail:send", async (data: { tempId?: string; recipientId: string; subject?: string; body: string }, callback?: (res: any) => void) => {
    const recipientId = String(data?.recipientId || "").trim();
    const body = String(data?.body || "").trim();

    if (!recipientId || !body) {
      callback?.({ success: false, error: "البيانات ناقصة" });
      return;
    }

    try {
      const mail = await sendMail(user.id, recipientId, body);

      const enrichedMail = {
        ...mail,
        senderName: user.topic || user.username || user.id,
        senderAvatar: user.avatar || "/pic.png",
        senderNameColor: mail.senderNameColor || user.nameColor || "",
      };

      publishGlobalEvent("internal_mail", enrichedMail).catch(err => 
        console.error("Failed to broadcast mail:", err)
      );

      if (String(user.id) !== recipientId) {
        createNotification(recipientId, user.id, "mail", "internal_mail", mail.id, {
          body: body.slice(0, 100),
        }).catch(err => console.error("Failed to create mail notification:", err));
      }

      callback?.({ success: true, mail: enrichedMail });
    } catch (err: any) {
      console.error("Error sending mail via socket:", err);
      callback?.({ success: false, error: err.message || "تعذر إرسال البريد" });
    }
  });

  /**
   * جلب الصندوق الوارد
   */
  socket.on("mail:get_inbox", async (callback?: (res: any) => void) => {
    try {
      const inbox = await getInbox(user.id);
      const unreadCount = await getUnreadCount(user.id);
      callback?.({ success: true, inbox, unreadCount });
    } catch (err: any) {
      console.error("Error getting inbox via socket:", err);
      callback?.({ success: false, error: "تعذر جلب الصندوق الوارد" });
    }
  });

  /**
   * جلب الصندوق الصادر
   */
  socket.on("mail:get_outbox", async (callback?: (res: any) => void) => {
    try {
      const outbox = await getOutbox(user.id);
      callback?.({ success: true, outbox });
    } catch (err: any) {
      console.error("Error getting outbox via socket:", err);
      callback?.({ success: false, error: "تعذر جلب الصندوق الصادر" });
    }
  });

  /**
   * تحديد بريد كمقروء
   */
  socket.on("mail:mark_read", async (data: { mailId: string }, callback?: (res: any) => void) => {
    const mailId = String(data?.mailId || "").trim();
    if (!mailId) {
      callback?.({ success: false, error: "معرف الرسالة مطلوب" });
      return;
    }

    try {
      await markAsRead(mailId, user.id);
      const unreadCount = await getUnreadCount(user.id);
      callback?.({ success: true, unreadCount });
    } catch (err: any) {
      console.error("Error marking mail read via socket:", err);
      callback?.({ success: false, error: "تعذر تحديث حالة الرسالة" });
    }
  });

  /**
   * حذف بريد
   */
  socket.on("mail:delete", async (data: { mailId: string }, callback?: (res: any) => void) => {
    const mailId = String(data?.mailId || "").trim();
    if (!mailId) {
      callback?.({ success: false, error: "معرف الرسالة مطلوب" });
      return;
    }

    try {
      await deleteMail(mailId, user.id);
      callback?.({ success: true });
    } catch (err: any) {
      console.error("Error deleting mail via socket:", err);
      callback?.({ success: false, error: "تعذر حذف الرسالة" });
    }
  });
}
