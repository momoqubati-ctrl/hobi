import {
  defineEventHandler,
  getHeader,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { getIO } from "../../../socket";
import { SOCKET_CHANNELS } from "../../../socket/SocketChannels";
import { getUserAuthContext } from "../../../services/adminAccess";
import { hasChatFeatureAccess } from "../../../services/chatAuthorization";
import {
  isEphemeralPrivateMessagingEnabled,
  privateMessageStore,
  registerPrivateMessageSession,
  resolveUserIdentity,
} from "../../../services/privateMessageService";
import { stagePrivateMediaViaBridge } from "../../../services/privateMessageMediaBridge";
import {
  getPrivateMessageMediaMaxBytes,
  validatePrivateMessageMedia,
  type PrivateMessageMediaType,
} from "../../../services/privateMessageMedia";

const isMediaType = (value: string): value is PrivateMessageMediaType =>
  value === "image" || value === "video" || value === "audio";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
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

  const receiverId = (getHeader(event, "x-pm-recipient-id") || "").trim();
  const mediaTypeValue = (getHeader(event, "x-pm-media-type") || "").trim();
  const contentType = (getHeader(event, "content-type") || "").trim().toLowerCase();
  const contentLength = Number(getHeader(event, "content-length"));
  if (!receiverId || !isMediaType(mediaTypeValue) ||
      !Number.isSafeInteger(contentLength) || contentLength <= 0 ||
      contentLength > getPrivateMessageMediaMaxBytes(mediaTypeValue)) {
    setResponseStatus(event, 400);
    return { success: false, message: "بيانات الوسيط غير صالحة أو يتجاوز الحد المسموح" };
  }

  const permission = mediaTypeValue === "audio"
    ? "private_audio_message.use"
    : "private_media.use";
  if (!(await hasChatFeatureAccess({ id: auth.userId, role: auth.role, username: auth.username }, [permission]))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية إرسال هذا الوسيط" };
  }

  const rawBody = await readRawBody(event, false);
  if (!rawBody) {
    setResponseStatus(event, 400);
    return { success: false, message: "الملف فارغ" };
  }
  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  if (bytes.length !== contentLength ||
      !validatePrivateMessageMedia(bytes, contentType, mediaTypeValue)) {
    setResponseStatus(event, 415);
    return { success: false, message: "نوع الملف غير مدعوم أو محتواه غير صالح" };
  }

  const resolvedReceiver = await resolveUserIdentity(receiverId).catch(() => null);
  const targetReceiverId = resolvedReceiver?.id || receiverId;

  const io = getIO();
  if (io && privateMessageStore.getActiveSocketSessionIds(targetReceiverId).length === 0) {
    for (const [_, s] of io.sockets.sockets) {
      const u = s.data?.user;
      if (u && String(u.id) === targetReceiverId && u.sessionId) {
        registerPrivateMessageSession({
          sessionId: String(u.sessionId),
          userId: targetReceiverId,
          expiresAt: Number(u.sessionExpiresAt || Date.now() + 86400000),
        });
        privateMessageStore.attachSocket(String(u.sessionId), s.id);
        s.join(SOCKET_CHANNELS.privateMessageSession(String(u.sessionId)));
      }
    }
  }

  // في وضع التطوير يعمل هذا المسار داخل عامل Nitro منفصل عن متجر الرسائل الخاص
  // المؤقت (الذي يعيش مع Socket.io في العملية الرئيسية لـ Vite)، لذلك نرسل الوسيط
  // عبر الجسر الداخلي أولًا، ونستخدم التخزين المحلي كخيار احتياطي فقط.
  const bridgedResult = await stagePrivateMediaViaBridge({
    sessionId: auth.sessionId,
    sessionExpiresAt: auth.expiresAt,
    userId: auth.userId,
    receiverId: targetReceiverId,
    contentType,
    mediaType: mediaTypeValue,
    bytes,
  });
  if (bridgedResult.bridged) {
    if (!bridgedResult.mediaId) {
      setResponseStatus(event, 409);
      return { success: false, message: bridgedResult.message };
    }
    return { success: true, mediaId: bridgedResult.mediaId, mediaType: mediaTypeValue };
  }

  const mediaId = privateMessageStore.stageMedia({
    sessionId: auth.sessionId,
    receiverId: targetReceiverId,
    contentType,
    mediaType: mediaTypeValue,
    bytes,
  });
  if (!mediaId) {
    setResponseStatus(event, 409);
    return { success: false, message: "تعذر إرسال الوسيط؛ يرجى التحقق من الملف وحالة الاتصال والمحاولة مرة أخرى" };
  }

  return { success: true, mediaId, mediaType: mediaTypeValue };
});
