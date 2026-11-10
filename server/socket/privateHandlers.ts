import type { Server, Socket } from "socket.io";
import { getMessagePermissionRequirements } from "../../src/lib/chatFeaturePermissions";
import { hasChatFeatureAccess } from "../services/chatAuthorization";
import { processPrivateMessageText } from "../services/privateMessageText";
import { dbPool } from "../db";
import {
  endPrivateMessageSession,
  isEphemeralPrivateMessagingEnabled,
  privateMessageStore,
  registerPrivateMessageSession,
  resolvePrivateMessageUser,
} from "../services/privateMessageService";
import { SOCKET_CHANNELS } from "./SocketChannels";

export type PMReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

export const PM_REACTIONS: PMReactionType[] = ["like", "love", "haha", "wow", "sad", "angry"];

const emitSessionEnd = (
  io: Server,
  ended: NonNullable<ReturnType<typeof endPrivateMessageSession>>,
) => {
  try {
    const sessionRoom = SOCKET_CHANNELS.privateMessageSession(ended.sessionId);
    const roomSize = io.sockets.adapter.rooms.get(sessionRoom)?.size ?? 0;
  } catch (_) {}
  for (const conversation of ended.expiredConversations) {
    for (const sessionId of conversation.sessionIds) {
      io.to(SOCKET_CHANNELS.privateMessageSession(sessionId)).emit("pm:conversation_expired", {
        conversationId: conversation.conversationId,
        reason: ended.reason,
      });
    }
  }
  const sessionRoom = SOCKET_CHANNELS.privateMessageSession(ended.sessionId);
  io.to(sessionRoom).emit("force_logout", {
    message: ended.reason === "expired" ? "انتهت صلاحية الجلسة" : "تم إنهاء الجلسة",
  });
  io.in(sessionRoom).disconnectSockets(true);
};

export function registerPrivateHandlers(io: Server, socket: Socket): void {
  const rawUser = socket.data?.user;
  if (!rawUser) return;

  const myId = String(rawUser.id || "");
  const sessionId = String(rawUser.sessionId || "");
  const sessionExpiresAt = Number(rawUser.sessionExpiresAt);

  if (!isEphemeralPrivateMessagingEnabled() || !myId || !sessionId) {
    socket.emit("pm:unavailable", {
      message: isEphemeralPrivateMessagingEnabled()
        ? "جلسة الرسائل الخاصة غير صالحة"
        : "الرسائل الخاصة المؤقتة غير مهيأة على هذا الخادم",
    });
    return;
  }

  // ضمان تسجيل الجلسة وربط السوكيت بها
  registerPrivateMessageSession({
    sessionId,
    userId: myId,
    expiresAt: sessionExpiresAt,
  });
  privateMessageStore.attachSocket(sessionId, socket.id);
  socket.join(SOCKET_CHANNELS.privateMessageSession(sessionId));

  // منع تكرار تسجيل مستمعي الأحداث على نفس السوكيت
  if ((socket as any).__privateHandlersRegistered) {
    return;
  }
  (socket as any).__privateHandlersRegistered = true;

  privateMessageStore.setSessionEndedListener((ended) => emitSessionEnd(io, ended));
  socket.on("disconnect", () => {
    (socket as any).__privateHandlersRegistered = false;
    privateMessageStore.detachSocket(sessionId, socket.id);
  });
  socket.on("user_logout", () => endPrivateMessageSession(sessionId, "logout"));

  const getSenderInfo = () => {
    const u = socket.data?.user || rawUser;
    return {
      id: myId,
      // الاسم المستعار فقط — يظهر للمستقبل
      name: String(u.displayName || u.name || (u as any).topic || "عضو"),
      avatar: String(u.avatar || rawUser.avatar || "/pic.png"),
      nameColor: String(u.nameColor || rawUser.nameColor || ""),
      messageColor: String(u.messageColor || rawUser.messageColor || ""),
    };
  };

  socket.on("pm:send", async (
    data: {
      toUserId?: unknown;
      text?: unknown;
      clientId?: unknown;
      mediaUrl?: unknown;
      mediaType?: unknown;
      mediaId?: unknown;
      stickerId?: unknown;
      replyToId?: unknown;
      animatedFaces?: unknown;
    },
    callback?: (response: Record<string, unknown>) => void,
  ) => {
    try {
      if (!isEphemeralPrivateMessagingEnabled()) {
        return callback?.({ success: false, error: "الرسائل الخاصة غير مهيأة" });
      }
      if (data?.mediaUrl) {
        return callback?.({ success: false, error: "رابط الوسيط غير مسموح" });
      }

      const receiverId = String(data?.toUserId || "").trim();
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      const clientId = typeof data?.clientId === "string" ? data.clientId : undefined;
      const replyToId = typeof data?.replyToId === "string" ? data.replyToId : undefined;
      const mediaId = typeof data?.mediaId === "string" ? data.mediaId : undefined;
      const stickerId = typeof data?.stickerId === "string" ? data.stickerId : undefined;
      const mediaType = data?.mediaType === "image" || data?.mediaType === "video" || data?.mediaType === "audio"
        ? data.mediaType
        : undefined;
      if ((data?.mediaType && !mediaType) || (mediaId && stickerId) ||
          (mediaId && !mediaType) || (stickerId && mediaType !== "image")) {
        return callback?.({ success: false, error: "نوع الوسيط غير صالح" });
      }
      const animatedFaces = Array.isArray(data?.animatedFaces)
        ? data.animatedFaces.filter((face): face is string =>
            typeof face === "string" && face.length > 0 && face.length <= 2048,
          ).slice(0, 10)
        : undefined;

      if (!receiverId || (!text && !animatedFaces?.length && !mediaId && !stickerId)) {
        return callback?.({ success: false, error: "بيانات الرسالة ناقصة" });
      }
      if (text.length > 1000) {
        return callback?.({ success: false, error: "الرسالة طويلة جدًا" });
      }
      if (receiverId === myId) {
        return callback?.({ success: false, error: "لا يمكنك مراسلة نفسك" });
      }

      const currentUser = socket.data?.user || rawUser;
      const sender = getSenderInfo();

      // تأكيد استمرارية جلسة المرسل وسوكيته
      registerPrivateMessageSession({
        sessionId,
        userId: myId,
        expiresAt: sessionExpiresAt,
      });
      privateMessageStore.attachSocket(sessionId, socket.id);

      const permissions = getMessagePermissionRequirements({
        channel: "private",
        text,
        mediaType,
        hasMedia: Boolean(mediaId || stickerId),
        hasEffects: Boolean(animatedFaces?.length || stickerId),
      });
      if (!(await hasChatFeatureAccess(currentUser, permissions))) {
        return callback?.({ success: false, error: "لا تملك صلاحية استخدام إحدى ميزات رسالة الخاص" });
      }
      if (currentUser.muted) {
        return callback?.({ success: false, muted: true, error: "تم منعك من الحديث في الدردشة" });
      }

      const receiver = await resolvePrivateMessageUser(receiverId);
      if (!receiver) {
        return callback?.({ success: false, error: "المستخدم غير موجود" });
      }

      // إذا كان المستلم متصلاً في السيرفر عبر Socket لكن لم تُسجل جلسته في المتجر بعد، يتم استعادتها لحظياً
      let recipientSessions = privateMessageStore.getActiveSocketSessionIds(receiver.id);
      if (recipientSessions.length === 0) {
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

      let stickerUrl: string | undefined;
      if (stickerId) {
        const sticker = await dbPool.query(
          `SELECT s.image_url
           FROM stickers s
           JOIN sticker_categories c ON c.id = s.category_id
           WHERE s.id::text = $1 AND s.is_active = true AND c.is_active = true
           LIMIT 1`,
          [stickerId],
        );
        stickerUrl = typeof sticker.rows[0]?.image_url === "string"
          ? sticker.rows[0].image_url
          : undefined;
        if (!stickerUrl) {
          return callback?.({ success: false, error: "الملصق غير موجود" });
        }
      }

      const filteredText = text
        ? await processPrivateMessageText(text, {
            username: sender.name,
            topic: sender.name,
            ip: socket.handshake.address || "127.0.0.1",
            recipientId: receiver.id,
            recipientName: receiver.name,
          })
        : "";
      const result = privateMessageStore.send({
        sessionId,
        sender,
        receiver,
        text: filteredText,
        clientId,
        replyToId,
        nameColor: sender.nameColor,
        statusFontColor: String(currentUser.statusFontColor || ""),
        animatedFaces,
        mediaId,
        mediaType,
        stickerUrl,
      });

      for (const targetSessionId of result.deliverySessionIds) {
        io.to(SOCKET_CHANNELS.privateMessageSession(targetSessionId))
          .emit("pm:message", result.message);
      }
      callback?.({ success: true, message: result.message });
    } catch (error) {
      console.error("[PM:send] Failed to process ephemeral message:", error);
      callback?.({
        success: false,
        error: error instanceof Error ? error.message : "تعذر إرسال الرسالة",
      });
    }
  });

  socket.on("pm:history", (
    data: { conversationId?: unknown },
    callback?: (response: Record<string, unknown>) => void,
  ) => {
    const conversationId = typeof data?.conversationId === "string" ? data.conversationId : "";
    callback?.({
      success: true,
      messages: conversationId ? privateMessageStore.getMessages(sessionId, conversationId) : [],
    });
  });

  socket.on("pm:conversations", (callback?: (response: Record<string, unknown>) => void) => {
    callback?.({ success: true, conversations: privateMessageStore.listConversations(sessionId) });
  });

  socket.on("pm:read", (data: { conversationId?: unknown }) => {
    const conversationId = typeof data?.conversationId === "string" ? data.conversationId : "";
    if (!conversationId) return;
    const result = privateMessageStore.markRead(sessionId, conversationId);
    if (result.changed) {
      for (const targetSessionId of result.otherSessionIds) {
        io.to(SOCKET_CHANNELS.privateMessageSession(targetSessionId)).emit("pm:read", {
          conversationId,
          readerId: myId,
        });
      }
    }
    socket.emit("pm:unread_update", { conversationId, unreadCount: 0 });
  });

  socket.on("pm:typing", (data: { toUserId?: unknown }) => {
    const toUserId = typeof data?.toUserId === "string" ? data.toUserId.trim() : "";
    const currentUser = socket.data?.user || rawUser;
    if (!toUserId || toUserId === myId || currentUser.muted) return;
    const sender = getSenderInfo();
    for (const targetSessionId of privateMessageStore.getActiveSocketSessionIds(toUserId)) {
      io.to(SOCKET_CHANNELS.privateMessageSession(targetSessionId)).emit("pm:typing", {
        fromUserId: myId,
        username: sender.name,
      });
    }
  });

  socket.on("pm:stop_typing", (data: { toUserId?: unknown }) => {
    const toUserId = typeof data?.toUserId === "string" ? data.toUserId.trim() : "";
    if (!toUserId || toUserId === myId) return;
    for (const targetSessionId of privateMessageStore.getActiveSocketSessionIds(toUserId)) {
      io.to(SOCKET_CHANNELS.privateMessageSession(targetSessionId)).emit("pm:stop_typing", {
        fromUserId: myId,
      });
    }
  });

  socket.on("pm:react", async (
    data: {
      messageId?: unknown;
      conversationId?: unknown;
      reaction?: unknown;
    },
    callback?: (response: Record<string, unknown>) => void,
  ) => {
    const conversationId = typeof data?.conversationId === "string" ? data.conversationId : "";
    const messageId = typeof data?.messageId === "string" ? data.messageId : "";
    const reaction = data?.reaction;
    if (!conversationId || !messageId || typeof reaction !== "string" || !PM_REACTIONS.includes(reaction as PMReactionType)) {
      return callback?.({ success: false, error: "بيانات التفاعل غير صالحة" });
    }
    const currentUser = socket.data?.user || rawUser;
    if (!(await hasChatFeatureAccess(currentUser, ["private_reactions.use"]))) {
      return callback?.({ success: false, error: "لا تملك صلاحية التفاعل مع رسائل الخاص" });
    }

    const result = privateMessageStore.react(sessionId, conversationId, messageId, reaction);
    if (!result) return callback?.({ success: false, error: "المحادثة أو الرسالة غير موجودة" });
    const update = { messageId, conversationId, reactions: result.reactions };
    for (const targetSessionId of result.sessionIds) {
      io.to(SOCKET_CHANNELS.privateMessageSession(targetSessionId)).emit("pm:reaction", update);
    }
    callback?.({ success: true, reactions: result.reactions });
  });
}


