import { dbPool } from "../db/index";
import { randomUUID } from "node:crypto";
import { eventBus } from "../core/events/EventBus";
import { bootstrapWorkers } from "../workers";

export type ChatRoom = {
  id: string;
  name: string;
  description: string;
  owner: string;
  image: string;
  members: number;
  mics: number;
  likes: number;
  locked: boolean;
};

export type RoomReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

export const ROOM_REACTIONS: RoomReactionType[] = ["like", "love", "haha", "wow", "sad", "angry"];

export type ChatMessage = {
  id: string;
  roomId: string;
  clientId?: string;
  user: string;
  userId?: string;
  role: "guest" | "member" | "admin" | "bot" | "system";
  text: string;
  avatar: string;
  countryCode: string;
  avatarFrameUrl?: string;
  giftIconUrl?: string;
  messageBubbleStyle?: string;
  color: string;
  isOwner?: boolean;
  isSystem?: boolean;
  reactions?: Record<string, RoomReactionType>;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  createdAt: string;
};

// Room messages are intentionally transient: they are emitted live only and are not retained.
const subscribersByRoom = new Map<string, Set<(message: ChatMessage) => void>>();

// ─── مخزن رسائل الغرف في الذاكرة (للردود والتفاعل) ──────────────────────────
const ROOM_MSG_CACHE_TTL = 30 * 60 * 1000; // 30 دقيقة
const roomMessagesCache = new Map<string, Map<string, ChatMessage>>();

const getRoomMsgMap = (roomId: string) => {
  if (!roomMessagesCache.has(roomId)) {
    roomMessagesCache.set(roomId, new Map());
  }
  return roomMessagesCache.get(roomId)!;
};

export const cacheRoomMessage = (msg: ChatMessage) => {
  const map = getRoomMsgMap(msg.roomId);
  map.set(msg.id, msg);
  // تنظيف الرسائل القديمة
  if (map.size > 200) {
    const now = Date.now();
    for (const [id, m] of map) {
      if (now - new Date(m.createdAt).getTime() > ROOM_MSG_CACHE_TTL) {
        map.delete(id);
      }
    }
  }
};

export const getRoomMessage = (roomId: string, messageId: string): ChatMessage | undefined => {
  return roomMessagesCache.get(roomId)?.get(messageId);
};

export const updateRoomMessageReactions = (roomId: string, messageId: string, reactions: Record<string, RoomReactionType>) => {
  const msg = roomMessagesCache.get(roomId)?.get(messageId);
  if (msg) {
    msg.reactions = reactions;
  }
};
const ROOM_CACHE_TTL_MS = 60_000;
let cachedRooms: ChatRoom[] | null = null;
let cachedRoomsAt = 0;
let pendingRoomsLoad: Promise<ChatRoom[]> | null = null;

const DEFAULT_ROOMS = [
  {
    id: "general",
    name: "الغرفة العامة",
    description: "أهلاً بكم في الغرفة العامة للجميع",
    owner: "إدارة الموقع",
    image: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop",
    members: 0, mics: 5, likes: 1000, locked: false,
  },
  {
    id: "events",
    name: "غرفة المسابقات",
    description: "مسابقات وألعاب تفاعلية مباشرة",
    owner: "المشرف الذهبي",
    image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=400&fit=crop",
    members: 0, mics: 3, likes: 500, locked: false,
  }
];

const cloneRooms = (rooms: ChatRoom[]) => rooms.map((room) => ({ ...room }));

const setRoomCache = (rooms: ChatRoom[]) => {
  cachedRooms = cloneRooms(rooms);
  cachedRoomsAt = Date.now();
};

const isRoomCacheFresh = () => cachedRooms && Date.now() - cachedRoomsAt < ROOM_CACHE_TTL_MS;

export const invalidateRoomCache = () => {
  cachedRooms = null;
  cachedRoomsAt = 0;
  pendingRoomsLoad = null;
};

const loadRoomsFromDatabase = async () => {
  try {
    // محاولة جلب الغرف باستخدام الاستعلام المتوافق مع القاعدة القديمة
    const result = await dbPool.query(`
      SELECT 
        idroom as "id",
        id as "slug",
        topic as "name",
        about as "description",
        owner,
        pic as "image",
        mic as "mics",
        COALESCE(needpass, 0) != 0 as "locked"
      FROM rooms 
      WHERE COALESCE(deleted, 0) = 0
      ORDER BY idroom ASC
      LIMIT 100
    `);

    if (result.rowCount === 0) {
      setRoomCache(DEFAULT_ROOMS);
      return DEFAULT_ROOMS;
    }

    const rooms = result.rows.map(r => ({
      id: String(r.slug || r.id),
      name: r.name || "غرفة بدون اسم",
      description: r.description || "",
      owner: r.owner || "إدارة الموقع",
      image: r.image || "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop",
      members: 0,
      mics: Number(r.mics) || 0,
      likes: 0,
      locked: Boolean(r.locked),
    }));
    setRoomCache(rooms);
    return rooms;
  } catch (err) {
    console.error("Failed to list rooms from DB, using defaults:", err);
    setRoomCache(DEFAULT_ROOMS);
    return DEFAULT_ROOMS;
  }
};

export const listRooms = async () => {
  if (isRoomCacheFresh()) {
    return cloneRooms(cachedRooms!);
  }

  if (pendingRoomsLoad) {
    return cloneRooms(await pendingRoomsLoad);
  }

  pendingRoomsLoad = loadRoomsFromDatabase();

  try {
    return cloneRooms(await pendingRoomsLoad);
  } finally {
    pendingRoomsLoad = null;
  }
};

export const listMessages = (roomId: string, after?: string) => {
  void roomId;
  void after;
  return [];
};

export const updateUserMessageIdentity = (
  username: string,
  updates: { avatar?: string; avatarFrameUrl?: string; giftIconUrl?: string; messageBubbleStyle?: string },
) => {
  void username;
  void updates;
};

export const addMessage = (input: {
  roomId: string;
  clientId?: string;
  user?: string;
  userId?: string;
  role?: ChatMessage["role"];
  countryCode?: string;
  avatar?: string;
  avatarFrameUrl?: string;
  giftIconUrl?: string;
  messageBubbleStyle?: string;
  text: string;
  isSystem?: boolean;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
}) => {
  // Keep room messages live-only: create the payload, emit it, and discard it.
  const message: ChatMessage = {
    id: randomUUID(),
    roomId: input.roomId,
    clientId: input.clientId,
    user: input.user?.trim().slice(0, 80) || "زائر",
    userId: input.userId,
    role: input.role ?? "guest",
    avatar: input.avatar?.trim().slice(0, 255) || "/pic.png",
    countryCode: String(input.countryCode || "SA").trim().toUpperCase().slice(0, 2) || "SA",
    avatarFrameUrl: input.avatarFrameUrl?.trim().slice(0, 255) || "",
    giftIconUrl: input.giftIconUrl?.trim().slice(0, 255) || "",
    messageBubbleStyle: input.messageBubbleStyle?.trim().slice(0, 64) || "default",
    text: input.text.trim().slice(0, 1000),
    color: input.role === "admin" ? "text-red-600" : "text-slate-700",
    isOwner: input.role === "admin",
    isSystem: input.isSystem || false,
    reactions: {},
    replyToId: input.replyToId || undefined,
    replyToText: input.replyToText || undefined,
    replyToSenderName: input.replyToSenderName || undefined,
    createdAt: new Date().toISOString(),
  };

  // حفظ الرسالة في الذاكرة للردود والتفاعل
  cacheRoomMessage(message);

  subscribersByRoom.get(input.roomId)?.forEach((callback) => callback(message));

  bootstrapWorkers();
  eventBus.publish({
    type: "message.sent",
    stream: "messages",
    actor: {
      username: message.user,
      role: message.role,
    },
    target: {
      id: message.id,
      type: "message",
      roomId: message.roomId,
    },
    payload: {
      id: message.id,
      clientId: message.clientId,
      roomId: message.roomId,
      text: message.text,
      role: message.role,
      createdAt: message.createdAt,
    },
    metadata: {
      roomId: message.roomId,
      source: "chatStore.addMessage",
      shardKey: message.roomId,
    },
  }).catch(err => console.error("EventBus publish failed in addMessage:", err));
  
  return message;
};

export const subscribeToRoom = (roomId: string, callback: (message: ChatMessage) => void) => {
  const subscribers = subscribersByRoom.get(roomId) ?? new Set<(message: ChatMessage) => void>();
  subscribers.add(callback);
  subscribersByRoom.set(roomId, subscribers);

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      subscribersByRoom.delete(roomId);
    }
  };
};
