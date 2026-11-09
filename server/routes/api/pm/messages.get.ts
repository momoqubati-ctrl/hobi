import { getQuery, setResponseHeader, setResponseStatus } from "h3";
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
  const query = getQuery(event);
  const conversationId = typeof query.conversationId === "string" ? query.conversationId : "";
  const beforeId = typeof query.beforeId === "string" ? query.beforeId : undefined;

  if (!conversationId) {
    setResponseStatus(event, 400);
    return { success: false, message: "conversationId مطلوب" };
  }

  const messages = privateMessageStore.getMessages(auth.sessionId, conversationId);
  const beforeIndex = beforeId ? messages.findIndex((message) => message.id === beforeId) : -1;
  const end = beforeIndex >= 0 ? beforeIndex : messages.length;
  return { success: true, messages: messages.slice(Math.max(0, end - 50), end) };
});
