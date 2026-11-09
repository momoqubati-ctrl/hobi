import { randomUUID } from "node:crypto";
import { validatePrivateMessageMedia, getPrivateMessageMediaMaxBytes } from "./privateMessageMedia";

export type EphemeralPmUser = {
  id: string;
  name: string;
  avatar: string;
};

export type EphemeralPmSession = {
  sessionId: string;
  userId: string;
  expiresAt: number;
};

export type EphemeralPmMessage = {
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
  reactions: Record<string, string>;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  animatedFaces?: string[];
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "file";
  mediaId?: string;
  fileName?: string;
  fileSize?: number;
  createdAt: string;
  read: boolean;
};

type StoredMessage = EphemeralPmMessage & {
  senderSessionId: string;
  requestFingerprint: string;
};

type Conversation = {
  id: string;
  userA: EphemeralPmUser;
  userB: EphemeralPmUser;
  sessionIds: Set<string>;
  messages: StoredMessage[];
  updatedAt: string;
};

type Session = EphemeralPmSession & {
  socketIds: Set<string>;
  timer: NodeJS.Timeout;
};

type PendingMedia = {
  id: string;
  sessionId: string;
  senderId: string;
  receiverId: string;
  contentType: string;
  mediaType: "image" | "video" | "audio" | "file";
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  bytes?: Buffer;
  timer: NodeJS.Timeout;
};

type StoredMedia = Omit<PendingMedia, "sessionId" | "timer"> & {
  conversationId: string;
};

export type ExpiredPrivateMessageConversation = {
  conversationId: string;
  sessionIds: string[];
};

export type EndedPrivateMessageSession = {
  sessionId: string;
  userId: string;
  reason: "logout" | "expired";
  expiredConversations: ExpiredPrivateMessageConversation[];
};

export class PrivateMessageRecipientOfflineError extends Error {
  constructor() {
    super("لا يمكن إرسال رسالة خاصة ما لم يكن المستلم متصلاً");
    this.name = "PrivateMessageRecipientOfflineError";
  }
}

export class PrivateMessageSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateMessageSessionError";
  }
}

export class PrivateMessageIdempotencyConflictError extends Error {
  constructor() {
    super("Client message ID was reused with different content");
    this.name = "PrivateMessageIdempotencyConflictError";
  }
}

const MAX_MESSAGES_PER_CONVERSATION = 100;
const MAX_CLIENT_ID_LENGTH = 128;
const MAX_PENDING_MEDIA_PER_SESSION = 2;
const MAX_EPHEMERAL_MEDIA_BYTES = 32 * 1024 * 1024;
const PENDING_MEDIA_TTL_MS = 5 * 60 * 1000;

const buildConversationId = (firstUserId: string, secondUserId: string) =>
  [firstUserId, secondUserId].sort().join(":");

const cloneMessage = (message: EphemeralPmMessage): EphemeralPmMessage => ({
  ...message,
  reactions: { ...message.reactions },
});

export class EphemeralPrivateMessageStore {
  private readonly sessions = new Map<string, Session>();
  private readonly revokedSessions = new Map<string, { expiresAt: number; timer: NodeJS.Timeout }>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly pendingMedia = new Map<string, PendingMedia>();
  private readonly storedMedia = new Map<string, StoredMedia>();
  private onSessionEnded?: (ended: EndedPrivateMessageSession) => void;

  constructor(
    private readonly maxMessagesPerConversation = MAX_MESSAGES_PER_CONVERSATION,
  ) {}

  setSessionEndedListener(listener: (ended: EndedPrivateMessageSession) => void): void {
    this.onSessionEnded = listener;
  }

  registerSession(identity: EphemeralPmSession, now = Date.now()): boolean {
    const sessionId = String(identity.sessionId || "").trim();
    const userId = String(identity.userId || "").trim();
    if (!sessionId || !userId || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= now) {
      return false;
    }

    const revoked = this.revokedSessions.get(sessionId);
    if (revoked && revoked.expiresAt > now) return false;
    if (revoked) {
      clearTimeout(revoked.timer);
      this.revokedSessions.delete(sessionId);
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.userId !== userId || existing.expiresAt !== identity.expiresAt) {
        throw new PrivateMessageSessionError("Session identity does not match the active session");
      }
      return true;
    }

    const timer = setTimeout(
      () => this.endSession(sessionId, "expired"),
      Math.max(1, identity.expiresAt - now),
    );
    timer.unref?.();
    this.sessions.set(sessionId, {
      sessionId,
      userId,
      expiresAt: identity.expiresAt,
      socketIds: new Set(),
      timer,
    });
    return true;
  }

  attachSocket(sessionId: string, socketId: string): boolean {
    const session = this.getLiveSession(sessionId);
    if (!session || !socketId) return false;
    session.socketIds.add(socketId);
    return true;
  }

  detachSocket(sessionId: string, socketId: string): void {
    this.sessions.get(sessionId)?.socketIds.delete(socketId);
  }

  stageMedia(input: {
    sessionId: string;
    receiverId: string;
    contentType: string;
    mediaType: "image" | "video" | "audio" | "file";
    mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  bytes?: Buffer;
  }, now = Date.now()): string | null {
    const session = this.getLiveSession(input.sessionId, now);
    const hasData = Boolean((input.bytes && input.bytes.length > 0) || input.mediaUrl);
    if (!session || !input.receiverId || input.receiverId === session.userId || !hasData) {
      return null;
    }



    const maxBytes = getPrivateMessageMediaMaxBytes(input.mediaType);
    if (input.bytes.length > maxBytes ||
        !validatePrivateMessageMedia(input.bytes, input.contentType, input.mediaType)) return null;
    const pendingCount = [...this.pendingMedia.values()]
      .filter((media) => media.sessionId === input.sessionId || media.senderId === session.userId).length;
    if (pendingCount >= MAX_PENDING_MEDIA_PER_SESSION) {
      const oldest = [...this.pendingMedia.values()]
        .filter((media) => media.sessionId === input.sessionId || media.senderId === session.userId)[0];
      if (oldest) {
        this.deletePendingMedia(oldest.id);
      }
    }
    const currentBytes = [...this.pendingMedia.values(), ...this.storedMedia.values()]
      .reduce((total, media) => total + media.bytes.length, 0);
    if (currentBytes + input.bytes.length > MAX_EPHEMERAL_MEDIA_BYTES) return null;

    const id = randomUUID();
    const timer = setTimeout(() => this.deletePendingMedia(id), PENDING_MEDIA_TTL_MS);
    timer.unref?.();
    this.pendingMedia.set(id, {
      ...input,
      id,
      senderId: session.userId,
      sessionId: input.sessionId,
      timer,
      bytes: Buffer.from(input.bytes),
    });
    return id;
  }

  send(input: {
    sessionId: string;
    sender: EphemeralPmUser;
    receiver: EphemeralPmUser;
    text: string;
    clientId?: string;
    replyToId?: string;
    nameColor?: string;
    statusFontColor?: string;
    animatedFaces?: string[];
    mediaId?: string;
  fileName?: string;
  fileSize?: number;
    stickerUrl?: string;
    mediaType?: "image" | "video" | "audio" | "file";
    now?: number;
  }): { message: EphemeralPmMessage; deliverySessionIds: string[] } {
    const now = input.now ?? Date.now();
    const senderSession = this.getLiveSession(input.sessionId, now);
    if (!senderSession || senderSession.userId !== input.sender.id) {
      throw new PrivateMessageSessionError("جلسة المرسل غير صالحة");
    }
    if (!input.sender.id || !input.receiver.id || input.sender.id === input.receiver.id) {
      throw new PrivateMessageSessionError("المستلم غير صالح");
    }
    const conversationId = buildConversationId(input.sender.id, input.receiver.id);
    const existingConversation = this.conversations.get(conversationId);
    const clientId = typeof input.clientId === "string" && input.clientId.trim()
      ? input.clientId.trim().slice(0, MAX_CLIENT_ID_LENGTH)
      : undefined;
    const previousMessage = clientId
      ? existingConversation?.messages.find((message) =>
          message.clientId === clientId &&
          message.senderSessionId === input.sessionId,
        )
      : undefined;
    const pendingMedia = input.mediaId ? this.pendingMedia.get(input.mediaId) : undefined;
    const storedMedia = input.mediaId ? this.storedMedia.get(input.mediaId) : undefined;
    const hasPendingMedia = Boolean(
      pendingMedia &&
      pendingMedia.senderId === input.sender.id &&
      (pendingMedia.receiverId === input.receiver.id ||
       buildConversationId(pendingMedia.senderId, pendingMedia.receiverId) === conversationId) &&
      pendingMedia.mediaType === input.mediaType
    );
    const hasStoredMediaRetry = Boolean(storedMedia && previousMessage?.mediaId === storedMedia.id &&
      storedMedia.senderId === input.sender.id && storedMedia.receiverId === input.receiver.id &&
      storedMedia.mediaType === input.mediaType);
    const hasMedia = hasPendingMedia || hasStoredMediaRetry;
    const hasSticker = Boolean(input.stickerUrl && input.mediaType === "image");
    if (input.mediaId && !hasMedia) {
      throw new PrivateMessageSessionError("مرفق الرسالة غير صالح أو انتهت صلاحيته");
    }
    if ((!input.text.trim() && !hasMedia && !hasSticker) || input.text.length > 1000) {
      throw new PrivateMessageSessionError("نص الرسالة غير صالح");
    }
    if (input.stickerUrl && !hasSticker) {
      throw new PrivateMessageSessionError("الملصق غير صالح");
    }

    const recipientSessions = this.getLiveSessionsForUser(input.receiver.id, now)
      .filter((session) => session.socketIds.size > 0);
    if (recipientSessions.length === 0) throw new PrivateMessageRecipientOfflineError();

    let conversation = this.conversations.get(conversationId);
    if (!conversation) {
      const sortedUsers = [input.sender, input.receiver].sort((a, b) => a.id.localeCompare(b.id));
      conversation = {
        id: conversationId,
        userA: sortedUsers[0],
        userB: sortedUsers[1],
        sessionIds: new Set(),
        messages: [],
        updatedAt: new Date(now).toISOString(),
      };
      this.conversations.set(conversationId, conversation);
    } else {
      conversation.userA = input.sender.id === conversation.userA.id ? input.sender : input.receiver;
      conversation.userB = input.sender.id === conversation.userB.id ? input.sender : input.receiver;
    }

    const requestFingerprint = JSON.stringify([
      input.receiver.id,
      input.text,
      input.replyToId || "",
      input.animatedFaces || [],
      input.mediaId || "",
      input.stickerUrl || "",
    ]);
    if (clientId) {
      const previous = conversation.messages.find((message) =>
        message.clientId === clientId &&
        message.senderSessionId === input.sessionId,
      );
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) {
          throw new PrivateMessageIdempotencyConflictError();
        }
        const senderSessions = this.getLiveSessionsForUser(input.sender.id, now)
          .filter((session) => session.socketIds.size > 0);
        senderSessions.push(senderSession);
        for (const session of [...senderSessions, ...recipientSessions]) {
          conversation.sessionIds.add(session.sessionId);
        }
        return {
          message: cloneMessage(previous),
          deliverySessionIds: [...conversation.sessionIds].sort(),
        };
      }
    }

    const senderSessions = this.getLiveSessionsForUser(input.sender.id, now)
      .filter((session) => session.socketIds.size > 0);
    senderSessions.push(senderSession);
    for (const session of [...senderSessions, ...recipientSessions]) {
      conversation.sessionIds.add(session.sessionId);
    }

    const parentMessage = input.replyToId
      ? conversation.messages.find((message) => message.id === input.replyToId)
      : undefined;
    const message: StoredMessage = {
      id: randomUUID(),
      clientId,
      conversationId,
      senderId: input.sender.id,
      senderName: input.sender.name,
      senderAvatar: input.sender.avatar,
      nameColor: input.nameColor,
      statusFontColor: input.statusFontColor,
      receiverId: input.receiver.id,
      text: input.text,
      reactions: {},
      replyToId: parentMessage?.id,
      replyToText: parentMessage?.text,
      replyToSenderName: parentMessage?.senderName,
      animatedFaces: input.animatedFaces?.slice(0, 10),
      mediaUrl: hasMedia ? `/api/pm/media/${input.mediaId}` : input.stickerUrl,
      mediaType: hasMedia || hasSticker ? input.mediaType : undefined,
      mediaId: hasMedia ? input.mediaId : undefined,
      createdAt: new Date(now).toISOString(),
      read: false,
      senderSessionId: input.sessionId,
      requestFingerprint,
    };

    conversation.messages.push(message);
    if (hasPendingMedia && pendingMedia) {
      clearTimeout(pendingMedia.timer);
      this.pendingMedia.delete(pendingMedia.id);
      this.storedMedia.set(pendingMedia.id, {
        id: pendingMedia.id,
        senderId: pendingMedia.senderId,
        receiverId: pendingMedia.receiverId,
        contentType: pendingMedia.contentType,
        mediaType: pendingMedia.mediaType,
        bytes: pendingMedia.bytes,
        conversationId,
      });
    }
    if (conversation.messages.length > this.maxMessagesPerConversation) {
      const evicted = conversation.messages.shift();
      if (evicted?.mediaId) this.storedMedia.delete(evicted.mediaId);
    }
    conversation.updatedAt = message.createdAt;

    return {
      message: cloneMessage(message),
      deliverySessionIds: [...conversation.sessionIds].sort(),
    };
  }

  listConversations(sessionId: string): Array<{
    conversationId: string;
    lastMessage: string;
    lastMessageAt: string;
    otherUser: EphemeralPmUser;
    unreadCount: number;
  }> {
    const session = this.getLiveSession(sessionId);
    if (!session) return [];

    return [...this.conversations.values()]
      .filter((conversation) =>
        conversation.sessionIds.has(sessionId) &&
        (conversation.userA.id === session.userId || conversation.userB.id === session.userId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((conversation) => {
        const otherUser = conversation.userA.id === session.userId
          ? conversation.userB
          : conversation.userA;
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        return {
          conversationId: conversation.id,
          lastMessage: lastMessage?.text || "",
          lastMessageAt: conversation.updatedAt,
          otherUser,
          unreadCount: conversation.messages.filter((message) =>
            message.receiverId === session.userId && !message.read,
          ).length,
        };
      });
  }

  getMessages(sessionId: string, conversationId: string): EphemeralPmMessage[] {
    const conversation = this.getAuthorizedConversation(sessionId, conversationId);
    return conversation ? conversation.messages.map(cloneMessage) : [];
  }

  getMedia(sessionId: string, mediaId: string): { bytes: Buffer; contentType: string } | null {
    const media = this.storedMedia.get(mediaId);
    if (!media || !this.getAuthorizedConversation(sessionId, media.conversationId)) return null;
    return { bytes: media.bytes, contentType: media.contentType };
  }

  markRead(sessionId: string, conversationId: string): {
    changed: boolean;
    otherSessionIds: string[];
  } {
    const session = this.getLiveSession(sessionId);
    const conversation = this.getAuthorizedConversation(sessionId, conversationId);
    if (!session || !conversation) return { changed: false, otherSessionIds: [] };

    let changed = false;
    for (const message of conversation.messages) {
      if (message.receiverId === session.userId && !message.read) {
        message.read = true;
        changed = true;
      }
    }
    const otherSessionIds = [...conversation.sessionIds]
      .filter((id) => this.sessions.get(id)?.userId !== session.userId)
      .sort();
    return { changed, otherSessionIds };
  }

  react(
    sessionId: string,
    conversationId: string,
    messageId: string,
    reaction: string,
  ): { reactions: Record<string, string>; sessionIds: string[] } | null {
    const session = this.getLiveSession(sessionId);
    const conversation = this.getAuthorizedConversation(sessionId, conversationId);
    const message = conversation?.messages.find((item) => item.id === messageId);
    if (!session || !conversation || !message) return null;

    if (message.reactions[session.userId] === reaction) {
      delete message.reactions[session.userId];
    } else {
      message.reactions[session.userId] = reaction;
    }
    return {
      reactions: { ...message.reactions },
      sessionIds: [...conversation.sessionIds].sort(),
    };
  }

  getDeliverySessionIds(sessionId: string, conversationId: string): string[] {
    const conversation = this.getAuthorizedConversation(sessionId, conversationId);
    if (!conversation) return [];
    return [...conversation.sessionIds]
      .filter((id) => this.getLiveSession(id)?.socketIds.size)
      .sort();
  }

  getActiveSocketSessionIds(userId: string): string[] {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId && session.socketIds.size > 0)
      .map((session) => session.sessionId)
      .sort();
  }

  getUnreadCount(sessionId: string): number {
    return this.listConversations(sessionId)
      .reduce((total, conversation) => total + conversation.unreadCount, 0);
  }

  endSession(sessionId: string, reason: "logout" | "expired" = "logout"): EndedPrivateMessageSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    clearTimeout(session.timer);
    this.sessions.delete(sessionId);
    if (reason === "logout" && session.expiresAt > Date.now()) {
      const timer = setTimeout(() => this.revokedSessions.delete(sessionId), session.expiresAt - Date.now());
      timer.unref?.();
      this.revokedSessions.set(sessionId, { expiresAt: session.expiresAt, timer });
    }
    const expiredConversations: ExpiredPrivateMessageConversation[] = [];
    for (const [conversationId, conversation] of this.conversations) {
      if (!conversation.sessionIds.has(sessionId)) continue;
      expiredConversations.push({
        conversationId,
        sessionIds: [...conversation.sessionIds].sort(),
      });
      this.conversations.delete(conversationId);
      for (const [mediaId, media] of this.storedMedia) {
        if (media.conversationId === conversationId) this.storedMedia.delete(mediaId);
      }
    }
    for (const [mediaId, media] of this.pendingMedia) {
      if (media.sessionId === sessionId) this.deletePendingMedia(mediaId);
    }

    const ended = {
      sessionId,
      userId: session.userId,
      reason,
      expiredConversations,
    };
    this.onSessionEnded?.(ended);
    return ended;
  }

  expireSessions(now = Date.now()): EndedPrivateMessageSession[] {
    const expired: EndedPrivateMessageSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) {
        const ended = this.endSession(session.sessionId, "expired");
        if (ended) expired.push(ended);
      }
    }
    return expired;
  }

  dispose(): void {
    for (const session of this.sessions.values()) clearTimeout(session.timer);
    this.sessions.clear();
    for (const revoked of this.revokedSessions.values()) clearTimeout(revoked.timer);
    this.revokedSessions.clear();
    this.conversations.clear();
    for (const media of this.pendingMedia.values()) clearTimeout(media.timer);
    this.pendingMedia.clear();
    this.storedMedia.clear();
    this.onSessionEnded = undefined;
  }

  private getLiveSession(sessionId: string, now = Date.now()): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.expiresAt <= now) this.endSession(sessionId, "expired");
    return session && session.expiresAt > now ? session : undefined;
  }

  private getLiveSessionsForUser(userId: string, now: number): Session[] {
    return [...this.sessions.values()].filter((session) =>
      session.userId === userId && this.getLiveSession(session.sessionId, now) !== undefined,
    );
  }

  private getAuthorizedConversation(sessionId: string, conversationId: string): Conversation | undefined {
    const session = this.getLiveSession(sessionId);
    const conversation = this.conversations.get(conversationId);
    if (!session || !conversation) return undefined;
    const isParticipant = conversation.userA.id === session.userId || conversation.userB.id === session.userId;
    if (!isParticipant) return undefined;
    conversation.sessionIds.add(sessionId);
    return conversation;
  }

  private deletePendingMedia(mediaId: string): void {
    const media = this.pendingMedia.get(mediaId);
    if (!media) return;
    clearTimeout(media.timer);
    this.pendingMedia.delete(mediaId);
  }
}
