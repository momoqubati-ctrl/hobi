/**
 * Private Message Handlers - Real-time In-Memory Only
 * يدير أحداث الرسائل الخاصة بين المستخدمين بشكل لحظي بدون قاعدة بيانات
 * الرسائل مؤقتة في ذاكرة الخادم (آخر 100 رسالة لكل محادثة)
 */
import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { getAllOnlineUsers } from "./presenceManager";
import { SOCKET_CHANNELS } from "./SocketChannels";
import { processText } from "../services/filterService";
import { applyShortcuts } from "../services/shortcutService";

// ─── أنواع البيانات ────────────────────────────────────────────────────────────

export type PMReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

export const PM_REACTIONS: PMReactionType[] = ["like", "love", "haha", "wow", "sad", "angry"];

interface PMUser {
  id: string;
  name: string;
  avatar: string;
}

interface PMMessage {
  id: string;
  clientId?: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  nameColor?: string;
  statusFontColor?: string;
  receiverId: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "video";
  reactions?: Record<string, PMReactionType>;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  replyToMediaUrl?: string;
  replyToMediaType?: "image" | "video";
  animatedFaces?: string[];
  createdAt: string;
  read: boolean;
}

interface Conversation {
  id: string;
  userA: PMUser;
  userB: PMUser;
  messages: PMMessage[];
  updatedAt: string;
}

// ─── مخزن الذاكرة المؤقت ────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_CONV = 100;

/** Map<conversationId, Conversation> */
const pmStore = new Map<string, Conversation>();

// ─── دوال مساعدة ─────────────────────────────────────────────────────────────

const buildConvId = (a: string, b: string): string => [a, b].sort().join(":");

const getOrCreateConv = (userA: PMUser, userB: PMUser): Conversation => {
  const id = buildConvId(userA.id, userB.id);
  if (!pmStore.has(id)) {
    pmStore.set(id, { id, userA, userB, messages: [], updatedAt: new Date().toISOString() });
  }
  const conv = pmStore.get(id)!;
  // تحديث معلومات المستخدمين دائماً بأحدث بيانات
  const sorted = [userA, userB].sort((a, b) => a.id.localeCompare(b.id));
  conv.userA = sorted[0];
  conv.userB = sorted[1];
  return conv;
};

const getUserConversations = (userId: string): Conversation[] =>
  Array.from(pmStore.values())
    .filter(c => c.userA.id === userId || c.userB.id === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

const getOtherUser = (conv: Conversation, myId: string): PMUser =>
  conv.userA.id === myId ? conv.userB : conv.userA;

const countUnread = (conv: Conversation, userId: string): number =>
  conv.messages.filter(m => m.receiverId === userId && !m.read).length;

const serializeConversations = (userId: string) =>
  getUserConversations(userId).map(conv => {
    const lastMsg = conv.messages[conv.messages.length - 1] || null;
    const otherUser = getOtherUser(conv, userId);
    return {
      conversationId: conv.id,
      lastMessage: lastMsg?.text || "",
      lastMessageAt: conv.updatedAt,
      otherUser,
      unreadCount: countUnread(conv, userId),
    };
  });

// ─── تسجيل معالجات Socket ────────────────────────────────────────────────────────

export function registerPrivateHandlers(io: Server, socket: Socket): void {
  const rawUser = socket.data.user;
  if (!rawUser) return;

  const myId = String(rawUser.id || rawUser.uid || socket.id);
  const myInfo: PMUser = {
    id: myId,
    name: String(rawUser.username || rawUser.name || "زائر"),
    avatar: String(rawUser.avatar || "/pic.png"),
  };

  // ─── إرسال رسالة خاصة ─────────────────────────────────────────────────────

  socket.on("pm:send", async (
    data: { toUserId: string; text: string; clientId?: string; mediaUrl?: string; mediaType?: "image" | "video"; replyToId?: string; animatedFaces?: string[] },
    callback?: (res: any) => void,
  ) => {
    try {
      const toUserId = String(data?.toUserId || "").trim();
      const text = String(data?.text || "").trim();
      const clientId = data?.clientId;
      const mediaUrl = data?.mediaUrl || "";
      const mediaType = data?.mediaType;
      const replyToId = data?.replyToId || "";

      if (!toUserId || (!text && !mediaUrl && !data?.animatedFaces?.length)) {
        return callback?.({ success: false, error: "بيانات الرسالة ناقصة" });
      }
      if (text.length > 1000) {
        return callback?.({ success: false, error: "الرسالة طويلة جداً (الحد 1000 حرف)" });
      }
      if (toUserId === myId) {
        return callback?.({ success: false, error: "لا يمكنك مراسلة نفسك" });
      }

      // فحص الإسكات - المستخدم المكتوم لا يمكنه إرسال رسائل خاصة
      if ((socket.data.user as any).muted) {
        return callback?.({ success: false, muted: true, error: "تم منعك من الحديث في الدردشة" });
      }

      // تطبيق الاختصارات ثم الفلتر على النص
      let filteredText = text;
      if (text) {
        try {
          const expanded = await applyShortcuts(text);
          const filterRes = await processText({
            text: expanded,
            source: `محادثة خاصة مع ${receiverInfo.name}`,
            user: { username: myInfo.name, topic: myInfo.name, ip: socket.handshake.address || "127.0.0.1" },
            target: toUserId,
          });
          filteredText = filterRes.filteredText;
        } catch {}
      }

      // جلب معلومات المستقبل — مع timeout 1.5s لتجنب التعليق
      let receiverInfo: PMUser = { id: toUserId, name: "عضو", avatar: "/pic.png" };
      try {
        const onlineUsers = await Promise.race([
          getAllOnlineUsers(),
          new Promise<any[]>(resolve => setTimeout(() => resolve([]), 1500)),
        ]);
        const found = onlineUsers.find((u: any) =>
          String(u.id) === toUserId || String(u.uid) === toUserId,
        );
        if (found) {
          receiverInfo = {
            id: toUserId,
            name: String(found.username || "عضو"),
            avatar: String(found.avatar || "/pic.png"),
          };
        } else {
          const existingConv = pmStore.get(buildConvId(myId, toUserId));
          if (existingConv) receiverInfo = getOtherUser(existingConv, myId);
        }
      } catch {
        // نستمر بمعلومات افتراضية
      }

      const conv = getOrCreateConv(myInfo, receiverInfo);

      // ─── جلب بيانات الرسالة المردود عليها ──────────────────────────────────
      let replyToText = "";
      let replyToSenderName = "";
      let replyToMediaUrl = "";
      let replyToMediaType: "image" | "video" | undefined;

      if (replyToId) {
        const parentMsg = conv.messages.find(m => m.id === replyToId);
        if (parentMsg) {
          replyToText = parentMsg.text || "";
          replyToSenderName = parentMsg.senderName || "";
          replyToMediaUrl = parentMsg.mediaUrl || "";
          replyToMediaType = parentMsg.mediaType;
        }
      }

      const msg: PMMessage = {
        id: randomUUID(),
        clientId,
        conversationId: conv.id,
        senderId: myId,
        senderName: myInfo.name,
        senderAvatar: myInfo.avatar,
        nameColor: socket.data.user.nameColor || "",
        statusFontColor: socket.data.user.statusFontColor || "",
        receiverId: toUserId,
        text: filteredText,
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaType || undefined,
        replyToId: replyToId || undefined,
        replyToText: replyToText || undefined,
        replyToSenderName: replyToSenderName || undefined,
        replyToMediaUrl: replyToMediaUrl || undefined,
        replyToMediaType: replyToMediaType || undefined,
        animatedFaces: data?.animatedFaces && data.animatedFaces.length > 0 ? data.animatedFaces : undefined,
        createdAt: new Date().toISOString(),
        read: false,
      };

      conv.messages.push(msg);
      if (conv.messages.length > MAX_MESSAGES_PER_CONV) conv.messages.shift();
      conv.updatedAt = msg.createdAt;

      // إيصال الرسالة للمستقبل عبر قناته الاجتماعية
      io.to(SOCKET_CHANNELS.social(toUserId)).emit("pm:message", msg);

      // إرسال الرسالة للمرسل أيضاً حتى تتحدث قائمة المحادثات لحظياً
      if (toUserId !== myId) {
        io.to(SOCKET_CHANNELS.social(myId)).emit("pm:message", msg);
      }

      callback?.({ success: true, message: msg });
    } catch (err) {
      console.error("[PM:send] Error:", err);
      callback?.({ success: false, error: "خطأ في الخادم" });
    }
  });

  // ─── جلب سجل محادثة ────────────────────────────────────────────────────────

  socket.on("pm:history", (
    data: { conversationId: string },
    callback?: (res: any) => void,
  ) => {
    try {
      const conversationId = String(data?.conversationId || "").trim();
      if (!conversationId) return callback?.({ success: true, messages: [] });

      const conv = pmStore.get(conversationId);
      if (!conv) return callback?.({ success: true, messages: [] });

      // التحقق من أن المستخدم طرف في المحادثة
      if (conv.userA.id !== myId && conv.userB.id !== myId) {
        return callback?.({ success: true, messages: [] });
      }

      // تعليم الرسائل المستلمة كمقروءة
      conv.messages.forEach(m => {
        if (m.receiverId === myId && !m.read) m.read = true;
      });

      callback?.({ success: true, messages: conv.messages });
    } catch (err) {
      console.error("[PM:history] Error:", err);
      callback?.({ success: true, messages: [] });
    }
  });

  // ─── جلب قائمة المحادثات ───────────────────────────────────────────────────

  socket.on("pm:conversations", (callback?: (res: any) => void) => {
    try {
      callback?.({ success: true, conversations: serializeConversations(myId) });
    } catch (err) {
      console.error("[PM:conversations] Error:", err);
      callback?.({ success: true, conversations: [] });
    }
  });

  // ─── تعليم محادثة كمقروءة ──────────────────────────────────────────────────

  socket.on("pm:read", (data: { conversationId: string }) => {
    try {
      const conversationId = String(data?.conversationId || "").trim();
      if (!conversationId) return;
      const conv = pmStore.get(conversationId);
      if (!conv) return;

      let changed = false;
      conv.messages.forEach(m => {
        if (m.receiverId === myId && !m.read) {
          m.read = true;
          changed = true;
        }
      });

      if (changed) {
        const otherUser = getOtherUser(conv, myId);
        io.to(SOCKET_CHANNELS.social(otherUser.id)).emit("pm:read", { conversationId, readerId: myId });
      }

      socket.emit("pm:unread_update", { conversationId, unreadCount: 0 });
    } catch (err) {
      console.error("[PM:read] Error:", err);
    }
  });

  // ─── إشعار الكتابة ─────────────────────────────────────────────────────────

  socket.on("pm:typing", (data: { toUserId: string }) => {
    const toUserId = String(data?.toUserId || "").trim();
    if (!toUserId || toUserId === myId) return;
    if ((socket.data.user as any).muted) return;
    io.to(SOCKET_CHANNELS.social(toUserId)).emit("pm:typing", {
      fromUserId: myId,
      username: myInfo.name,
    });
  });

  socket.on("pm:stop_typing", (data: { toUserId: string }) => {
    const toUserId = String(data?.toUserId || "").trim();
    if (!toUserId) return;
    io.to(SOCKET_CHANNELS.social(toUserId)).emit("pm:stop_typing", {
      fromUserId: myId,
    });
  });

  // ─── تفاعل على رسالة ──────────────────────────────────────────────────────

  socket.on("pm:react", (
    data: { messageId: string; conversationId: string; reaction: PMReactionType },
    callback?: (res: any) => void,
  ) => {
    try {
      const conversationId = String(data?.conversationId || "").trim();
      const messageId = String(data?.messageId || "").trim();
      const reaction = data?.reaction;

      if (!conversationId || !messageId || !reaction) {
        return callback?.({ success: false, error: "بيانات ناقصة" });
      }

      if (!PM_REACTIONS.includes(reaction)) {
        return callback?.({ success: false, error: "نوع تفاعل غير صالح" });
      }

      const conv = pmStore.get(conversationId);
      if (!conv) {
        return callback?.({ success: false, error: "محادثة غير موجودة" });
      }

      // التحقق من أن المستخدم طرف في المحادثة
      if (conv.userA.id !== myId && conv.userB.id !== myId) {
        return callback?.({ success: false, error: "غير مصرح" });
      }

      const msg = conv.messages.find(m => m.id === messageId);
      if (!msg) {
        return callback?.({ success: false, error: "الرسالة غير موجودة" });
      }

      // تهيئة reactions إذا لم تكن موجودة
      if (!msg.reactions) msg.reactions = {};

      const existingReaction = msg.reactions[myId];

      if (existingReaction === reaction) {
        // نفس التفاعل → إزالة (toggle off)
        delete msg.reactions[myId];
      } else {
        // تفاعل جديد أو تغيير
        msg.reactions[myId] = reaction;
      }

      const otherUserId = conv.userA.id === myId ? conv.userB.id : conv.userA.id;

      // إرسال التحديث لطرفي المحادثة
      const reactionUpdate = {
        messageId,
        conversationId,
        reactions: msg.reactions,
      };

      io.to(SOCKET_CHANNELS.social(myId)).emit("pm:reaction", reactionUpdate);
      io.to(SOCKET_CHANNELS.social(otherUserId)).emit("pm:reaction", reactionUpdate);

      callback?.({ success: true, reactions: msg.reactions });
    } catch (err) {
      console.error("[PM:react] Error:", err);
      callback?.({ success: false, error: "خطأ في الخادم" });
    }
  });
}
