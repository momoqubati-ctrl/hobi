import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { sendMail } from "../../../services/internalMailService";
import { createNotification } from "../../../services/notificationService";
import { publishGlobalEvent } from "../../../socket/SocketBroker";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { senderId, recipientId, text } = body;

  if (!senderId || !recipientId || !text?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "senderId, recipientId, text مطلوبون" };
  }

  try {
    const mail = await sendMail(senderId, recipientId, text);

    publishGlobalEvent("internal_mail", mail).catch(() => {});

    if (String(senderId) !== String(recipientId)) {
      createNotification(recipientId, senderId, "mail", "internal_mail", mail.id, {
        body: text.slice(0, 100),
      }).catch(() => {});
    }

    return { success: true, mail };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message || "تعذر إرسال البريد" };
  }
});
