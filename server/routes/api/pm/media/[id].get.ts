import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { getUserAuthContext } from "../../../../services/adminAccess";
import {
  isEphemeralPrivateMessagingEnabled,
  privateMessageStore,
  registerPrivateMessageSession,
} from "../../../../services/privateMessageService";
import { fetchPrivateMediaViaBridge } from "../../../../services/privateMessageMediaBridge";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId) {
    setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
    return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
  }
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

  const mediaId = getRouterParam(event, "id") || "";

  // استرجاع الوسيط من متجر الرسائل الخاص المؤقت عبر الجسر الداخلي أولًا
  // (يعمل المتجر مع Socket.io في العملية الرئيسية لـ Vite في وضع التطوير)،
  // مع الرجوع للمتجر المحلي عند تعذر الجسر (تشغيل أحادي العملية).
  const bridgeResult = await fetchPrivateMediaViaBridge(auth.sessionId, mediaId);
  if (bridgeResult.bridged) {
    if (!bridgeResult.media) {
      setResponseStatus(event, 404);
      return { success: false, message: "الوسيط غير موجود أو انتهت صلاحيته" };
    }
    setResponseHeader(event, "Content-Type", bridgeResult.media.contentType.split(";")[0]);
    setResponseHeader(event, "Content-Length", String(bridgeResult.media.bytes.length));
    setResponseHeader(event, "Content-Disposition", "inline");
    return bridgeResult.media.bytes;
  }

  const media = privateMessageStore.getMedia(auth.sessionId, mediaId);
  if (!media) {
    setResponseStatus(event, 404);
    return { success: false, message: "الوسيط غير موجود أو انتهت صلاحيته" };
  }

  setResponseHeader(event, "Content-Type", media.contentType.split(";")[0]);
  setResponseHeader(event, "Content-Length", String(media.bytes.length));
  setResponseHeader(event, "Content-Disposition", "inline");
  return media.bytes;
});
