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
  color?: string;
  welcome?: string;
  verified?: boolean;
  roomLayout?: string;
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
  nameColor?: string;
  statusFontColor?: string;
  giftedBannerUrl?: string;
  giftedGiftIconUrl?: string;
  giftedPromotionIconUrl?: string;
  color: string;
  isOwner?: boolean;
  isSystem?: boolean;
  reactions?: Record<string, RoomReactionType>;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaType?: "image" | "video" | "audio";
  sticker?: string;
  animatedFaces?: string[];
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
    color: "#000000", welcome: "أهلاً بك {user} في الغرفة العامة", verified: false, roomLayout: "normal",
  },
  {
    id: "events",
    name: "غرفة المسابقات",
    description: "مسابقات وألعاب تفاعلية مباشرة",
    owner: "المشرف الذهبي",
    image: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&h=400&fit=crop",
    members: 0, mics: 3, likes: 500, locked: false,
    color: "#000000", welcome: "أهلاً بك {user} في غرفة المسابقات", verified: false, roomLayout: "normal",
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
        COALESCE(needpass, 0) != 0 as "locked",
        color,
        welcome,
        COALESCE(verified, false) as "verified",
        COALESCE(room_layout, 'normal') as "roomLayout",
        COALESCE(max, 50) as "max",
        COALESCE(rmli, 0) as "likesRequired",
        COALESCE(broadcast, 0) != 0 as "broadcast",
        stage_state as "stage_state",
        COALESCE(stage_count, 5) as "stage_count"
      FROM rooms 
      WHERE COALESCE(deleted, 0) = 0
      ORDER BY idroom ASC
      LIMIT 100
    `);

    if (result.rowCount === 0) {
      setRoomCache(DEFAULT_ROOMS);
      return DEFAULT_ROOMS;
    }

    const rooms = result.rows.map(r => {
      let stageLocks: Record<string, boolean> = {};
      try {
        if (r.stage_state) {
          const parsed = typeof r.stage_state === 'string' ? JSON.parse(r.stage_state) : r.stage_state;
          stageLocks = Object.fromEntries(
            Object.entries(parsed).map(([k, v]) => [k, Boolean(v)])
          );
        }
      } catch (_) {}
      return {
        id: String(r.slug || r.id),
        name: r.name || "غرفة بدون اسم",
        description: r.description || "",
        owner: r.owner || "إدارة الموقع",
        image: r.image || "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop",
        members: 0,
        mics: Number(r.mics) || 0,
        likes: 0,
        locked: Boolean(r.locked),
        color: r.color || "#000000",
        welcome: r.welcome || "",
        verified: Boolean(r.verified),
        roomLayout: r.roomLayout || "normal",
        maxMembers: Number(r.max) || 50,
        likesRequired: Number(r.likesRequired) || 0,
        broadcast: Boolean(r.broadcast),
        stageLocks,
        stageCount: Number(r.stage_count) || 5,
      };
    });
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

export const createRoomInDatabase = async (data: {
  id: string;
  topic: string;
  about: string;
  welcome: string;
  pass: string;
  max: number;
  like: number;
  deleted: boolean;
  broadcast: boolean;
  mic: number;
  pic: string;
  color: string;
  owner: string;
  user: string;
  verified: boolean;
  roomLayout: string;
  stageLocks?: Record<string, boolean>;
}) => {
  const needpass = data.pass ? 1 : 0;
  const stageCountSafe = Math.max(0, Math.min(Number(data.mic) || 0, 5));
  const initialStageState = data.stageLocks
    ? JSON.stringify(Object.fromEntries(
        Object.entries(data.stageLocks).map(([key, val]) => [key, val ? 1 : 0]),
      ))
    : JSON.stringify({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 });
  const roomOwnerMeta = JSON.stringify({
    ownerId: data.owner,
    ownerUser: data.user,
    ownerTopic: data.user,
    badge_id: "",
    badge: { name: "", bg: "", icon: "", bg_type: "static" },
    assignments: [],
  });

  // Use the slug (data.id) for the slug column; generate UUID for id column automatically
  const slug = data.id;

  try {
    await dbPool.query(
      `INSERT INTO rooms
        (slug, topic, about, welcome, pass, max, rmli, deleted, broadcast, mic, stage_count, stage_state, pic, color, "user", owner, needpass, room_owner_meta, message_mode, verified, room_layout, is_public, name)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, true, $22)`,
      [
        slug,
        data.topic,
        data.about,
        data.welcome,
        data.pass || "",
        data.max,
        data.like || 0,
        data.deleted ? 1 : 0,
        data.broadcast ? 1 : 0,
        data.mic,
        stageCountSafe,
        initialStageState,
        data.pic || "room.png",
        data.color || "#000000",
        data.user,
        data.owner,
        needpass,
        roomOwnerMeta,
        "real",
        data.verified ? 1 : 0,
        data.roomLayout || "normal",
        data.topic,
      ],
    );
    invalidateRoomCache();
    return true;
  } catch (err) {
    console.error("Failed to create room:", err);
    return false;
  }
};

export const updateUserMessageIdentity = (
  username: string,
  updates: { avatar?: string; avatarFrameUrl?: string; giftIconUrl?: string; messageBubbleStyle?: string; nameColor?: string; statusFontColor?: string },
) => {
  if (!username) return;
  const normalized = username.trim().toLowerCase();
  for (const roomMsgs of roomMessagesCache.values()) {
    for (const [msgId, msg] of roomMsgs) {
      if (msg.user.trim().toLowerCase() !== normalized) continue;
      if (updates.avatar !== undefined) msg.avatar = updates.avatar;
      if (updates.avatarFrameUrl !== undefined) msg.avatarFrameUrl = updates.avatarFrameUrl;
      if (updates.giftIconUrl !== undefined) msg.giftIconUrl = updates.giftIconUrl;
      if (updates.messageBubbleStyle !== undefined) msg.messageBubbleStyle = updates.messageBubbleStyle;
      if (updates.nameColor !== undefined) msg.nameColor = updates.nameColor;
      if (updates.statusFontColor !== undefined) msg.statusFontColor = updates.statusFontColor;
    }
  }
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
  nameColor?: string;
  statusFontColor?: string;
  giftedBannerUrl?: string;
  giftedGiftIconUrl?: string;
  giftedPromotionIconUrl?: string;
  text: string;
  isSystem?: boolean;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaType?: "image" | "video" | "audio";
  sticker?: string;
  animatedFaces?: string[];
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
    nameColor: input.nameColor?.trim().slice(0, 20) || "",
    statusFontColor: input.statusFontColor?.trim().slice(0, 20) || "",
    giftedBannerUrl: input.giftedBannerUrl?.trim().slice(0, 500) || "",
    giftedGiftIconUrl: input.giftedGiftIconUrl?.trim().slice(0, 500) || "",
    giftedPromotionIconUrl: input.giftedPromotionIconUrl?.trim().slice(0, 500) || "",
    text: input.text.trim().slice(0, 1000) || (input.mediaType === "audio" ? "🎤 رسالة صوتية" : ""),
    color: input.role === "admin" ? "text-red-600" : "text-slate-700",
    isOwner: input.role === "admin",
    isSystem: input.isSystem || false,
    reactions: {},
    replyToId: input.replyToId || undefined,
    replyToText: input.replyToText || undefined,
    replyToSenderName: input.replyToSenderName || undefined,
    mediaUrl: input.mediaUrl || undefined,
    mediaUrls: input.mediaUrls && input.mediaUrls.length > 0 ? input.mediaUrls : undefined,
    mediaType: input.mediaType || undefined,
    sticker: input.sticker || undefined,
    animatedFaces: input.animatedFaces && input.animatedFaces.length > 0 ? input.animatedFaces : undefined,
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
