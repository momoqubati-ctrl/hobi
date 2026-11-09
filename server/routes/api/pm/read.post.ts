import { readBody, setResponseHeader, setResponseStatus } from "h3";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";
import {
  isEphemeralPrivateMessagingEnabled,
  privateMessageStore,
  registerPrivateMessageSession,
} from "../../../services/privateMessageService";

export default createAuthenticatedUserHandler(async (event, auth) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  if (!isEphemeralPrivateMessagingEnabled()) {
    setResponseStatus(event, 503);
    return { success: false, message: "الرسائل الخاصة المؤقتة غير مهيأة على هذا الخادم" };
  }
  if (!auth.sessionId || !registerPrivateMessageSession({
    sessionId: auth.sessionId,
    userId: auth.userId,
    expiresAt: auth.expiresAt,
  })) {
    setResponseStatus(event, 401);
    return { success: false, message: "جلسة غير صالحة" };
  }
  const body = await readBody<Record<string, unknown> | null>(event);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";

  if (!conversationId) {
    setResponseStatus(event, 400);
    return { success: false, message: "conversationId مطلوب" };
  }

  privateMessageStore.markRead(auth.sessionId, conversationId);
  return { success: true };
});
