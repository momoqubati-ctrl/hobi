import {
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getIO } from "../../../socket";
import { getUserAuthContext } from "../../../services/adminAccess";
import { hasChatFeatureAccess } from "../../../services/chatAuthorization";
import { getMessagePermissionRequirements } from "../../../../src/lib/chatFeaturePermissions";
import { processPrivateMessageText } from "../../../services/privateMessageText";
import {
  isEphemeralPrivateMessagingEnabled,
  privateMessageStore,
  registerPrivateMessageSession,
  resolvePrivateMessageUser,
} from "../../../services/privateMessageService";
import {
  PrivateMessageIdempotencyConflictError,
  PrivateMessageRecipientOfflineError,
  PrivateMessageSessionError,
  type EphemeralPmSession,
} from "../../../services/ephemeralPrivateMessageStore";
import { SOCKET_CHANNELS } from "../../../socket/SocketChannels";
import { dbPool } from "../../../db";
import { resolvePublicName } from "../../../utils/publicIdentity";

type AuthContext = ReturnType<typeof getUserAuthContext>;
type AuthenticatedContext = Extract<AuthContext, { ok: true }>;

/** جلب الاسم المستعار للمرسل من قاعدة البيانات (لا يُرسل اسم المستخدم الحقيقي أبداً) */
const resolveSenderPublicName = async (userId: string): Promise<string> => {
  try {
    const res = await dbPool.query(
      `SELECT idreg, username, display_name, topic FROM users
       WHERE id::text = $1 OR idreg::text = $1 OR uid::text = $1 OR lower(username) = lower($1) LIMIT 1`,
      [userId],
    );
    return resolvePublicName(res.rows[0]);
  } catch {
    return "عضو";
  }
};

type SendDependencies = {
  authenticate: (event: H3Event) => AuthContext;
  isEnabled: () => boolean;
  registerSession: (session: EphemeralPmSession) => boolean;
  isMuted: (userId: string) => Promise<boolean>;
  hasAccess: (user: { id: string; role: string }, permissions: string[]) => Promise<boolean>;
  processText: typeof processPrivateMessageText;
  resolveRecipient: typeof resolvePrivateMessageUser;
  sendMessage: typeof privateMessageStore.send;
  publishToSession: (sessionId: string, event: string, payload: unknown) => Promise<void>;
};

const isUserMuted = async (userId: string): Promise<boolean> => {
  const { dbPool } = await import("../../../db");
  const userRes = await dbPool.query(
    `SELECT u.muted as legacy_muted, up.muted as profile_muted
     FROM users u
     LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
     WHERE u.id::text = $1`,
    [userId],
  );
  const user = userRes.rows[0];
  return user
    ? Boolean(user.profile_muted) ||
      Boolean(user.legacy_muted && user.legacy_muted !== 0 && user.legacy_muted !== "0")
    : false;
};

const publishToSession = async (sessionId: string, event: string, payload: unknown) => {
  const io = getIO();
  if (!io) throw new Error("Socket server is unavailable");
  io.to(SOCKET_CHANNELS.privateMessageSession(sessionId)).emit(event, payload);
};

export function createPrivateMessageSendHandler(overrides: Partial<SendDependencies> = {}) {
  const dependencies: SendDependencies = {
    authenticate: getUserAuthContext,
    isEnabled: isEphemeralPrivateMessagingEnabled,
    registerSession: registerPrivateMessageSession,
    isMuted: isUserMuted,
    hasAccess: (user, permissions) => hasChatFeatureAccess(user, permissions),
    processText: processPrivateMessageText,
    resolveRecipient: resolvePrivateMessageUser,
    sendMessage: (input) => privateMessageStore.send(input),
    publishToSession,
    ...overrides,
  };

  return defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "private, no-store");
    const auth = dependencies.authenticate(event);
    if (!auth.ok || !auth.userId) {
      setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
      return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
    }
    if (!dependencies.isEnabled()) {
      setResponseStatus(event, 503);
      return { success: false, message: "الرسائل الخاصة المؤقتة غير مهيأة على هذا الخادم" };
    }
    if (!auth.sessionId || !dependencies.registerSession({
      sessionId: auth.sessionId,
      userId: auth.userId,
      expiresAt: auth.expiresAt,
    })) {
      setResponseStatus(event, 401);
      return { success: false, message: "جلسة غير صالحة" };
    }

    const body = await readBody<Record<string, unknown> | null>(event);
    if (body?.mediaUrl || body?.mediaType) {
      setResponseStatus(event, 415);
      return { success: false, message: "مرفقات الرسائل الخاصة معطلة مؤقتًا" };
    }

    const receiverId = body?.receiverId;
    const text = body?.text;
    const clientId = body?.clientId;
    const replyToId = body?.replyToId;
    const animatedFaces = body?.animatedFaces;
    if (
      (typeof receiverId !== "string" && typeof receiverId !== "number") ||
      !String(receiverId).trim() ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      setResponseStatus(event, 400);
      return { success: false, message: "receiverId و text مطلوبان" };
    }
    if (text.length > 1000) {
      setResponseStatus(event, 413);
      return { success: false, message: "الرسالة طويلة جدًا" };
    }
    if (clientId !== undefined && (typeof clientId !== "string" || clientId.length > 128)) {
      setResponseStatus(event, 400);
      return { success: false, message: "clientId غير صالح" };
    }
    if (replyToId !== undefined && typeof replyToId !== "string") {
      setResponseStatus(event, 400);
      return { success: false, message: "replyToId غير صالح" };
    }
    if (
      animatedFaces !== undefined &&
      (!Array.isArray(animatedFaces) ||
        animatedFaces.length > 10 ||
        animatedFaces.some((face) => typeof face !== "string" || face.length > 2048))
    ) {
      setResponseStatus(event, 400);
      return { success: false, message: "animatedFaces غير صالحة" };
    }

    const requiredPermissions = getMessagePermissionRequirements({
      channel: "private",
      text,
      hasEffects: Array.isArray(animatedFaces) && animatedFaces.length > 0,
    });
    if (!(await dependencies.hasAccess({ id: auth.userId, role: auth.role }, requiredPermissions))) {
      setResponseStatus(event, 403);
      return { success: false, message: "لا تملك صلاحية استخدام إحدى ميزات رسالة الخاص" };
    }

    try {
      if (await dependencies.isMuted(auth.userId)) {
        setResponseStatus(event, 403);
        return { success: false, message: "تم منعك من الحديث في الدردشة" };
      }

      const receiver = await dependencies.resolveRecipient(String(receiverId).trim());
      if (!receiver) {
        setResponseStatus(event, 404);
        return { success: false, message: "المستخدم غير موجود" };
      }
      if (receiver.id === auth.userId) {
        setResponseStatus(event, 400);
        return { success: false, message: "لا يمكنك مراسلة نفسك" };
      }

      const io = getIO();
      if (io && privateMessageStore.getActiveSocketSessionIds(receiver.id).length === 0) {
        for (const [_, s] of io.sockets.sockets) {
          const u = s.data?.user;
          if (u && String(u.id) === receiver.id && u.sessionId) {
            registerPrivateMessageSession({
              sessionId: String(u.sessionId),
              userId: receiver.id,
              expiresAt: Number(u.sessionExpiresAt || Date.now() + 86400000),
            });
            privateMessageStore.attachSocket(String(u.sessionId), s.id);
            s.join(SOCKET_CHANNELS.privateMessageSession(String(u.sessionId)));
          }
        }
      }

      const filteredText = await dependencies.processText(text.trim(), {
        username: auth.username || auth.userId,
        topic: auth.username || auth.userId,
        ip: event.node?.req?.socket?.remoteAddress || "127.0.0.1",
        recipientId: receiver.id,
        recipientName: receiver.name,
      });
      // الاسم المستعار فقط — هذا الاسم يظهر في رسائل الخاص للمستقبل
      const senderPublicName = await resolveSenderPublicName(auth.userId);
      const result = dependencies.sendMessage({
        sessionId: auth.sessionId,
        sender: { id: auth.userId, name: senderPublicName, avatar: "/pic.png" },
        receiver,
        text: filteredText,
        clientId: typeof clientId === "string" ? clientId : undefined,
        replyToId: typeof replyToId === "string" ? replyToId : undefined,
        animatedFaces: Array.isArray(animatedFaces) ? animatedFaces as string[] : undefined,
      });
      const deliveries = await Promise.all(
        result.deliverySessionIds.map((sessionId) =>
          dependencies.publishToSession(sessionId, "pm:message", result.message)
            .then(() => true)
            .catch((error) => {
              console.error("[PM] Ephemeral socket delivery failed:", error);
              return false;
            }),
        ),
      );

      return {
        success: true,
        message: result.message,
        realtimeDelivery: deliveries.every(Boolean) ? "delivered" : "failed",
      };
    } catch (error) {
      if (error instanceof PrivateMessageRecipientOfflineError) {
        setResponseStatus(event, 409);
        return { success: false, message: error.message };
      }
      if (error instanceof PrivateMessageIdempotencyConflictError) {
        setResponseStatus(event, 409);
        return { success: false, message: "تم استخدام clientId سابقًا مع رسالة مختلفة" };
      }
      if (error instanceof PrivateMessageSessionError) {
        setResponseStatus(event, 401);
        return { success: false, message: error.message };
      }
      console.error("[PM] Ephemeral REST send failed:", error);
      setResponseStatus(event, 500);
      return { success: false, message: "تعذر إرسال الرسالة" };
    }
  });
}

export default createPrivateMessageSendHandler();
