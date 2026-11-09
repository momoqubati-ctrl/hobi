import { defineEventHandler, readBody, setResponseStatus, type H3Event } from "h3";
import { getUserAuthContext } from "../../../services/adminAccess";
import { sendMail } from "../../../services/internalMailService";
import { createNotification } from "../../../services/notificationService";
import { publishMailToParticipants } from "../../../socket/mailDelivery";

type AuthContext = ReturnType<typeof getUserAuthContext>;
type MailRecord = {
  id: string;
  senderId: string | number;
  recipientId: string | number;
};

type InternalMailSendDependencies = {
  authenticate: (event: H3Event) => AuthContext;
  sendMail: (senderId: string, recipientId: string, text: string) => Promise<MailRecord>;
  createNotification: typeof createNotification;
  publishParticipants: typeof publishMailToParticipants;
};

export function createInternalMailSendHandler(
  overrides: Partial<InternalMailSendDependencies> = {},
) {
  const dependencies: InternalMailSendDependencies = {
    authenticate: getUserAuthContext,
    sendMail,
    createNotification,
    publishParticipants: publishMailToParticipants,
    ...overrides,
  };

  return defineEventHandler(async (event) => {
    const auth = dependencies.authenticate(event);
    if (!auth.ok || !auth.userId) {
      setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
      return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
    }

    const body = await readBody<Record<string, unknown> | null>(event);
    const recipientId = typeof body?.recipientId === "string" || typeof body?.recipientId === "number"
      ? String(body.recipientId).trim()
      : "";
    const text = typeof body?.text === "string" ? body.text : "";

    if (!recipientId || !text.trim()) {
      setResponseStatus(event, 400);
      return { success: false, message: "recipientId و text مطلوبان" };
    }

    try {
      const mail = await dependencies.sendMail(auth.userId, recipientId, text);
      let realtimeDelivery = "delivered";

      try {
        await dependencies.publishParticipants(mail, mail);
      } catch (error) {
        realtimeDelivery = "failed";
        console.error("[Mail] scoped socket delivery failed:", error);
      }

      if (String(auth.userId) !== String(mail.recipientId)) {
        dependencies.createNotification(String(mail.recipientId), auth.userId, "mail", "internal_mail", mail.id, {
          body: text.slice(0, 100),
        }).catch((error) => {
          console.error("[Mail] notification creation failed:", error);
        });
      }

      return { success: true, mail, realtimeDelivery };
    } catch (error) {
      console.error("[Mail] REST send failed:", error);
      setResponseStatus(event, 500);
      return { success: false, message: "تعذر إرسال البريد" };
    }
  });
}

export default createInternalMailSendHandler();
