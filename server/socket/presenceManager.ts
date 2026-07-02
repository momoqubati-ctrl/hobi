/**
 * Presence Manager (Stateless using Redis)
 * يدير حالة الحضور للمستخدمين المتصلين في كل غرفة عبر Redis
 */
import { redis, isRedisEnabled } from "../services/redis";

export type OnlineUser = {
  id: string;
  socketId: string;
  username: string;
  role: string;
  avatar: string;
  countryCode: string;
  avatarFrameUrl: string;
  giftIconUrl: string;
  memberCardBgUrl: string;
  nameColor: string;
  messageColor: string;
  messageBubbleStyle: string;
  roomId: string;
  connectedAt: string;
  status: "online" | "active" | "idle" | "busy" | "away";
  idreg: string;
  siteBadge: string;
  statusMsg: string;
};

// الذاكرة المحلية كبديل عند تعطيل Redis أو حدوث خطأ في الاتصال
const localSockets = new Map<string, OnlineUser>();
const localRoomMembers = new Map<string, Set<string>>(); // roomId -> Set of socketIds
const localOnlineSockets = new Set<string>();

// مفاتيح Redis
const getSocketKey = (socketId: string) => `socket:presence:${socketId}`;
const getRoomKey = (roomId: string) => `room:members:${roomId}`;
const ONLINE_SOCKETS_KEY = "online:sockets";

function getPresenceIdentity(user: Pick<OnlineUser, "id" | "username" | "role">): string {
  const id = String(user.id || "").trim();
  if (id && id !== "0") return `id:${id}`;

  const username = String(user.username || "").trim().toLowerCase();
  if (username && user.role !== "guest") return `username:${username}`;

  return "";
}

async function getDedupedOnlineUsers(): Promise<OnlineUser[]> {
  let users: OnlineUser[] = [];

  if (!isRedisEnabled) {
    users = Array.from(localSockets.values());
    console.debug("[presence] getDedupedOnlineUsers (local) count=", users.length);
  } else {
    try {
      const socketIds = await redis.smembers(ONLINE_SOCKETS_KEY);
      if (socketIds.length > 0) {
        const usersPromises = socketIds.map((sid) => getConnectedUser(sid));
        users = (await Promise.all(usersPromises)).filter((u): u is OnlineUser => u !== undefined);
      } else {
        users = Array.from(localSockets.values());
      }
    } catch (err) {
      console.warn("[presence] Redis smembers failed, falling back to local memory:", err);
      console.debug("[presence] getDedupedOnlineUsers fallback to local due to redis error");
      users = Array.from(localSockets.values());
    }
  }

  const byIdentity = new Map<string, OnlineUser>();
  const guests: OnlineUser[] = [];

  for (const user of users) {
    const identity = getPresenceIdentity(user);
    if (!identity) {
      guests.push(user);
      continue;
    }

    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, user);
    } else {
      const priorities: Record<string, number> = { "busy": 4, "away": 3, "idle": 2, "online": 1, "active": 1 };
      const currentPrio = priorities[existing.status] || 0;
      const newPrio = priorities[user.status] || 0;
      if (newPrio > currentPrio || (newPrio === currentPrio && new Date(user.connectedAt).getTime() > new Date(existing.connectedAt).getTime())) {
        byIdentity.set(identity, user);
      }
    }
  }

  return [...byIdentity.values(), ...guests];
}

/**
 * يضيف مستخدم متصل
 */
export async function addConnectedUser(socketId: string, user: Omit<OnlineUser, "socketId">): Promise<void> {
  const onlineUser: OnlineUser = { ...user, socketId };

  // تحديث الذاكرة المحلية أولاً دائماً كنسخة احتياطية جاهزة
  localSockets.set(socketId, onlineUser);
  localOnlineSockets.add(socketId);

  if (!isRedisEnabled) {
    console.debug(`[presence] addConnectedUser (local)`, socketId, { id: user.id, username: user.username, status: user.status });
    return;
  }

  try {
    const key = getSocketKey(socketId);
    const data = {
      id: String(user.id),
      username: String(user.username),
      role: String(user.role),
      avatar: String(user.avatar),
      countryCode: String(user.countryCode),
      avatarFrameUrl: String(user.avatarFrameUrl),
      giftIconUrl: String(user.giftIconUrl),
      memberCardBgUrl: String(user.memberCardBgUrl),
      nameColor: String(user.nameColor),
      messageColor: String(user.messageColor),
      messageBubbleStyle: String(user.messageBubbleStyle),
      roomId: String(user.roomId),
      connectedAt: String(user.connectedAt),
      status: String(user.status || "online"),
      idreg: String(user.idreg || ""),
      siteBadge: String(user.siteBadge || ""),
      statusMsg: String(user.statusMsg || ""),
    };

    await redis.hset(key, data);
    await redis.expire(key, 86400); // 24 ساعة كحد أقصى للسلامة العامة
    await redis.sadd(ONLINE_SOCKETS_KEY, socketId);
  } catch (err) {
    console.warn("[presence] Redis addConnectedUser failed, using local memory fallback:", err);
    console.debug(`[presence] addConnectedUser fallback to local`, socketId, { id: user.id, username: user.username });
  }
}

/**
 * يزيل مستخدم عند قطع الاتصال
 */
export async function removeConnectedUser(socketId: string): Promise<OnlineUser | undefined> {
  const user = await getConnectedUser(socketId);
  console.debug(`[presence] removeConnectedUser called`, socketId, user ? { id: user.id, username: user.username } : null);
  if (!user) return undefined;

  // إزالة من الذاكرة المحلية أولاً
  localSockets.delete(socketId);
  localOnlineSockets.delete(socketId);
  if (user.roomId) {
    const members = localRoomMembers.get(user.roomId);
    if (members) {
      members.delete(socketId);
      if (members.size === 0) {
        localRoomMembers.delete(user.roomId);
      }
    }
  }

  if (!isRedisEnabled) {
    return user;
  }

  try {
    await redis.del(getSocketKey(socketId));
    await redis.srem(ONLINE_SOCKETS_KEY, socketId);
    if (user.roomId) {
      await redis.srem(getRoomKey(user.roomId), socketId);
    }
  } catch (err) {
    console.warn("[presence] Redis removeConnectedUser failed, using local memory fallback:", err);
  }
  return user;
}

/**
 * يضيف مستخدم لغرفة معينة
 */
export async function joinRoom(socketId: string, roomId: string): Promise<void> {
  const user = await getConnectedUser(socketId);
  if (!user) return;

  // تحديث الذاكرة المحلية أولاً
  if (user.roomId && user.roomId !== roomId) {
    await leaveRoom(socketId);
  }
  user.roomId = roomId;
  if (!localRoomMembers.has(roomId)) {
    localRoomMembers.set(roomId, new Set());
  }
  localRoomMembers.get(roomId)!.add(socketId);

  if (!isRedisEnabled) {
    return;
  }

  try {
    await redis.hset(getSocketKey(socketId), "roomId", roomId);
    await redis.sadd(getRoomKey(roomId), socketId);
  } catch (err) {
    console.warn("[presence] Redis joinRoom failed, using local memory fallback:", err);
  }
}

/**
 * يزيل مستخدم من غرفته الحالية
 */
export async function leaveRoom(socketId: string): Promise<string | undefined> {
  const user = await getConnectedUser(socketId);
  if (!user || !user.roomId) return undefined;

  const roomId = user.roomId;

  // تحديث الذاكرة المحلية أولاً
  const members = localRoomMembers.get(roomId);
  if (members) {
    members.delete(socketId);
    if (members.size === 0) {
      localRoomMembers.delete(roomId);
    }
  }
  user.roomId = "";

  if (!isRedisEnabled) {
    return roomId;
  }

  try {
    await redis.srem(getRoomKey(roomId), socketId);
    await redis.hset(getSocketKey(socketId), "roomId", "");
  } catch (err) {
    console.warn("[presence] Redis leaveRoom failed, using local memory fallback:", err);
  }

  return roomId;
}

/**
 * يحصل على قائمة أعضاء غرفة معينة
 */
export async function getRoomMembers(roomId: string): Promise<OnlineUser[]> {
  if (!isRedisEnabled) {
    const sids = localRoomMembers.get(roomId);
    if (!sids || sids.size === 0) return [];
    const members: OnlineUser[] = [];
    for (const sid of sids) {
      const u = localSockets.get(sid);
      if (u) members.push(u);
    }
    return members;
  }

  try {
    const socketIds = await redis.smembers(getRoomKey(roomId));
    if (socketIds.length === 0) return [];

    const usersPromises = socketIds.map((sid) => getConnectedUser(sid));
    return (await Promise.all(usersPromises)).filter((u): u is OnlineUser => u !== undefined);
  } catch (err) {
    console.warn("[presence] Redis getRoomMembers failed, using local memory fallback:", err);
    const sids = localRoomMembers.get(roomId);
    if (!sids || sids.size === 0) return [];
    const members: OnlineUser[] = [];
    for (const sid of sids) {
      const u = localSockets.get(sid);
      if (u) members.push(u);
    }
    return members;
  }
}

/**
 * يحصل على عدد أعضاء غرفة
 */
export async function getRoomMemberCount(roomId: string): Promise<number> {
  if (!isRedisEnabled) {
    return localRoomMembers.get(roomId)?.size ?? 0;
  }
  try {
    return await redis.scard(getRoomKey(roomId));
  } catch (err) {
    console.warn("[presence] Redis scard failed, using local memory fallback:", err);
    return localRoomMembers.get(roomId)?.size ?? 0;
  }
}

/**
 * يحصل على كل المستخدمين المتصلين
 */
export async function getAllOnlineUsers(): Promise<OnlineUser[]> {
  return await getDedupedOnlineUsers();
}

/**
 * يحصل على عدد المتصلين الكلي
 */
export async function getTotalOnlineCount(): Promise<number> {
  const deduped = await getDedupedOnlineUsers();
  return deduped.length;
}

/**
 * يحصل على بيانات مستخدم متصل بواسطة socketId
 */
export async function getConnectedUser(socketId: string): Promise<OnlineUser | undefined> {
  const localUser = localSockets.get(socketId);
  if (!isRedisEnabled) {
    return localUser;
  }

  try {
    const data = await redis.hgetall(getSocketKey(socketId));
    if (!data || Object.keys(data).length === 0) return localUser;
    return {
      id: data.id,
      socketId,
      username: data.username,
      role: data.role,
      avatar: data.avatar,
      countryCode: data.countryCode,
      avatarFrameUrl: data.avatarFrameUrl,
      giftIconUrl: data.giftIconUrl,
      memberCardBgUrl: data.memberCardBgUrl || "",
      nameColor: data.nameColor || "",
      messageColor: data.messageColor || "",
      messageBubbleStyle: data.messageBubbleStyle,
      roomId: data.roomId,
      connectedAt: data.connectedAt,
      status: (data.status || "online") as any,
      idreg: data.idreg || "",
      siteBadge: data.siteBadge || "",
      statusMsg: data.statusMsg || "",
    };
  } catch (err) {
    console.warn("[presence] Redis hgetall failed, using local memory fallback:", err);
    return localUser;
  }
}

export const pendingDisconnects = new Map<string, {
  roomId: string;
  timeout: NodeJS.Timeout;
  presenceTimeout: NodeJS.Timeout;
  socketId: string;
  userData: any;
}>();

