/**
 * Presence Manager (Stateless using Redis)
 * يدير حالة الحضور للمستخدمين المتصلين في كل غرفة عبر Redis
 */
import { redis, isRedisEnabled } from "../services/redis";
import { publishGlobalEvent } from "./SocketBroker";

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
  statusFontColor: string;
  messageBubbleStyle: string;
  roomId: string;
  connectedAt: string;
  status: "online" | "active" | "idle" | "busy" | "away";
  idreg: string;
  siteBadge: string;
  statusMsg: string;
  giftedBannerUrl: string;
  giftedGiftIconUrl: string;
  giftedPromotionIconUrl: string;
  roleIconUrl: string;
  youtubeUrl: string;
  level?: number;
  exp?: number;
  roomRole?: string;
  roomPower?: number;
  customTitle?: string;
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
      statusFontColor: String(user.statusFontColor || ""),
      messageBubbleStyle: String(user.messageBubbleStyle),
      roomId: String(user.roomId),
      connectedAt: String(user.connectedAt),
      status: String(user.status || "online"),
      idreg: String(user.idreg || ""),
      siteBadge: String(user.siteBadge || ""),
      statusMsg: String(user.statusMsg || ""),
      giftedBannerUrl: String(user.giftedBannerUrl || ""),
      giftedGiftIconUrl: String(user.giftedGiftIconUrl || ""),
      giftedPromotionIconUrl: String(user.giftedPromotionIconUrl || ""),
      roleIconUrl: String(user.roleIconUrl || ""),
      level: String(user.level || 1),
      exp: String(user.exp || 0),
      roomRole: String(user.roomRole || "member"),
      roomPower: String(user.roomPower || 1000),
      customTitle: String(user.customTitle || ""),
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
 * إزالة جميع سجلات الحضور لمستخدم معين عبر معرّفه لضمان إنهاء جميع جلساته
 */
export async function removeUserPresenceByUserId(userId: string): Promise<string[]> {
  const removedSocketIds: string[] = [];
  const targetId = String(userId || "").trim();
  if (!targetId) return removedSocketIds;

  for (const [sid, user] of Array.from(localSockets.entries())) {
    if (String(user.id) === targetId || String(user.username).toLowerCase() === targetId.toLowerCase()) {
      removedSocketIds.push(sid);
      await removeConnectedUser(sid);
    }
  }

  if (isRedisEnabled) {
    try {
      const socketIds = await redis.smembers(ONLINE_SOCKETS_KEY);
      for (const sid of socketIds) {
        if (!removedSocketIds.includes(sid)) {
          const user = await getConnectedUser(sid);
          if (user && (String(user.id) === targetId || String(user.username).toLowerCase() === targetId.toLowerCase())) {
            removedSocketIds.push(sid);
            await removeConnectedUser(sid);
          }
        }
      }
    } catch (err) {
      console.warn("[presence] removeUserPresenceByUserId redis lookup failed:", err);
    }
  }

  return removedSocketIds;
}

/**
 * يضيف مستخدم لغرفة معينة
 */
export async function joinRoom(socketId: string, roomId: string): Promise<void> {
  const localUser = localSockets.get(socketId);
  const oldRoomId = localUser?.roomId || "";
  const localBefore = localRoomMembers.get(roomId)?.size ?? 0;
  let redisBefore = 0;
  if (isRedisEnabled) {
    try { redisBefore = await redis.scard(getRoomKey(roomId)); } catch (_) {}
  }
  console.log(`[PRESENCE_TRACE] joinRoom START socketId=${socketId} roomId=${roomId} oldRoomId=${oldRoomId} localBefore=${localBefore} redisBefore=${redisBefore} localRoomMembersKeys=${JSON.stringify(Array.from(localRoomMembers.keys()))}`);

  // تسجيل الغرفة القديمة قبل تحديث localUser.roomId لإزالتها من Redis لاحقاً
  const oldRoomIdForRedis = (localUser?.roomId && localUser.roomId !== roomId) ? localUser.roomId : null;

  if (localUser) {
    if (localUser.roomId && localUser.roomId !== roomId) {
      const oldMembers = localRoomMembers.get(localUser.roomId);
      const oldLocalSize = oldMembers?.size ?? 0;
      if (oldMembers) {
        oldMembers.delete(socketId);
        if (oldMembers.size === 0) {
          localRoomMembers.delete(localUser.roomId);
        }
      }
      console.log(`[PRESENCE_TRACE] joinRoom removed from oldRoom=${localUser.roomId} oldLocalSize=${oldLocalSize} newLocalSize=${oldMembers?.size ?? 0}`);
    }
    localUser.roomId = roomId;
  }

  if (!localRoomMembers.has(roomId)) {
    localRoomMembers.set(roomId, new Set());
  }
  localRoomMembers.get(roomId)!.add(socketId);

  const localAfter = localRoomMembers.get(roomId)?.size ?? 0;
  console.log(`[PRESENCE_TRACE] joinRoom localUpdateComplete roomId=${roomId} localSize=${localAfter}`);

  if (!isRedisEnabled) {
    console.log(`[PRESENCE_TRACE] joinRoom END (no redis) socketId=${socketId} roomId=${roomId} localAfter=${localAfter}`);
    return;
  }

  try {
    // إزالة الـ socket من الغرفة القديمة في Redis أولاً (Fix #3/#5: منع تسرب الـ socket في Redis)
    if (oldRoomIdForRedis) {
      await redis.srem(getRoomKey(oldRoomIdForRedis), socketId);
      console.log(`[PRESENCE_TRACE] joinRoom removed from oldRoom Redis set oldRoomId=${oldRoomIdForRedis}`);
    }
    // إضافة للغرفة الجديدة أولاً ثم تحديث الـ hash (Fix #4: sadd قبل hset)
    await redis.sadd(getRoomKey(roomId), socketId);
    await redis.hset(getSocketKey(socketId), "roomId", roomId);
    const redisAfterAdd = await redis.scard(getRoomKey(roomId));
    console.log(`[PRESENCE_TRACE] joinRoom redisComplete socketId=${socketId} roomId=${roomId} redisBefore=${redisBefore} redisAfterAdd=${redisAfterAdd} localAfter=${localAfter}`);
  } catch (err) {
    console.warn(`[PRESENCE_TRACE] joinRoom Redis FAILED socketId=${socketId} roomId=${roomId} err=${err}`, err);
  }
}

/**
 * يزيل مستخدم من غرفته الحالية
 * يقبل معامل اختياري targetRoomId لتحديد الغرفة بدقة بدلاً من الاعتماد على localUser.roomId
 */
export async function leaveRoom(socketId: string, targetRoomId?: string): Promise<string | undefined> {
  let localUser = localSockets.get(socketId);
  // استخدام targetRoomId إذا مُرّر، وإلا الرجوع لـ localUser.roomId (Fix #3)
  let roomId = targetRoomId || localUser?.roomId;

  if (!roomId && isRedisEnabled) {
    try {
      const data = await redis.hgetall(getSocketKey(socketId));
      if (data && Object.keys(data).length > 0) {
        roomId = data.roomId;
        console.log(`[PRESENCE_TRACE] leaveRoom recovered roomId from Redis socketId=${socketId} roomId=${roomId}`);
      }
    } catch (_) {}
  }

  if (!roomId) {
    console.log(`[PRESENCE_TRACE] leaveRoom no roomId found socketId=${socketId} localUser=${!!localUser}`);
    return undefined;
  }

  const localBefore = localRoomMembers.get(roomId)?.size ?? 0;
  let redisBefore = 0;
  if (isRedisEnabled) {
    try { redisBefore = await redis.scard(getRoomKey(roomId)); } catch (_) {}
  }
  console.log(`[PRESENCE_TRACE] leaveRoom START socketId=${socketId} roomId=${roomId} localBefore=${localBefore} redisBefore=${redisBefore}`);

  const members = localRoomMembers.get(roomId);
  if (members) {
    members.delete(socketId);
    if (members.size === 0) {
      localRoomMembers.delete(roomId);
    }
  }
  if (localUser && localUser.roomId === roomId) {
    localUser.roomId = "";
  }

  const localAfter = localRoomMembers.get(roomId)?.size ?? 0;
  console.log(`[PRESENCE_TRACE] leaveRoom localUpdateComplete roomId=${roomId} localAfter=${localAfter}`);

  if (!isRedisEnabled) {
    console.log(`[PRESENCE_TRACE] leaveRoom END (no redis) socketId=${socketId} roomId=${roomId} localAfter=${localAfter}`);
    return roomId;
  }

  try {
    // srem أولاً ثم hset (Fix #5: الترتيب الصحيح لعمليات Redis)
    await redis.srem(getRoomKey(roomId), socketId);
    await redis.hset(getSocketKey(socketId), "roomId", "");
    const redisAfter = await redis.scard(getRoomKey(roomId));
    console.log(`[PRESENCE_TRACE] leaveRoom redisComplete socketId=${socketId} roomId=${roomId} redisBefore=${redisBefore} redisAfter=${redisAfter} localAfter=${localAfter}`);
  } catch (err) {
    console.warn(`[PRESENCE_TRACE] leaveRoom Redis FAILED socketId=${socketId} roomId=${roomId} err=${err}`);
  }

  return roomId;
}

/**
 * يحصل على قائمة أعضاء غرفة معينة
 */
export async function getRoomMembers(roomId: string): Promise<OnlineUser[]> {
  if (!isRedisEnabled) {
    const candidateSocketIds = new Set<string>();

    // 1. From localRoomMembers
    const sids = localRoomMembers.get(roomId);
    if (sids) {
      for (const sid of sids) candidateSocketIds.add(sid);
    }
    const altRoomId = roomId.startsWith("room:") ? roomId.slice(5) : `room:${roomId}`;
    const altSids = localRoomMembers.get(altRoomId);
    if (altSids) {
      for (const sid of altSids) candidateSocketIds.add(sid);
    }

    // 2. From globalThis.__vite_room_members_map__ (Vite dev mode)
    const viteRoomMembersMap = (globalThis as any).__vite_room_members_map__;
    if (viteRoomMembersMap instanceof Map) {
      const vSids = viteRoomMembersMap.get(roomId) || viteRoomMembersMap.get(altRoomId);
      if (vSids) {
        for (const sid of vSids) candidateSocketIds.add(sid);
      }
    }

    // 3. From Socket.IO adapter
    try {
      const ioInstance = getIOInstance() || (globalThis as any).__socket_io_instance__;
      if (ioInstance?.sockets?.adapter?.rooms) {
        const adapterRooms = ioInstance.sockets.adapter.rooms;
        const r1 = adapterRooms.get(`room:${roomId}`);
        if (r1) for (const sid of r1) candidateSocketIds.add(sid);
        const r2 = adapterRooms.get(roomId);
        if (r2) for (const sid of r2) candidateSocketIds.add(sid);
      }
    } catch (_) {}

    const ioInstance = getIOInstance() || (globalThis as any).__socket_io_instance__;
    const viteConnectedUsers = (globalThis as any).__vite_connected_users__;
    const usersMap = new Map<string, OnlineUser>();

    for (const sid of candidateSocketIds) {
      let u: OnlineUser | undefined = localSockets.get(sid);
      if (!u && viteConnectedUsers instanceof Map) {
        u = viteConnectedUsers.get(sid);
      }
      if (!u && ioInstance) {
        const sock = ioInstance.sockets?.sockets?.get?.(sid);
        if (sock?.data?.user) {
          u = sock.data.user;
        }
      }
      if (u) {
        const userKey = String(u.id || u.username).toLowerCase();
        if (!usersMap.has(userKey)) {
          usersMap.set(userKey, { ...u });
        }
      }
    }

    const members = Array.from(usersMap.values());

    // Enrich missing idreg from users table
    const missingIdreg = members.filter((u) => !u.idreg && u.id && u.id !== "0");
    if (missingIdreg.length > 0) {
      try {
        const { dbPool } = await import("../db");
        const uIds = missingIdreg.map((u) => String(u.id));
        const uNames = missingIdreg.map((u) => String(u.username).toLowerCase());
        const idregRes = await dbPool.query(
          `SELECT id, idreg, username FROM users WHERE id::text = ANY($1::text[]) OR lower(username) = ANY($2::text[])`,
          [uIds, uNames]
        );
        for (const row of idregRes.rows) {
          if (row.idreg) {
            const m = members.find(
              (x) => String(x.id) === String(row.id) || String(x.username).toLowerCase() === String(row.username).toLowerCase()
            );
            if (m) {
              m.idreg = String(row.idreg);
            }
          }
        }
      } catch (_) {}
    }

    console.log(`[PRESENCE_TRACE] getRoomMembers roomId=${roomId} result=${members.length} candidateSockets=${candidateSocketIds.size}`);
    return members;
  }

  try {
    const socketIds = await redis.smembers(getRoomKey(roomId));
    const seen = new Set(socketIds);
    const localSids = localRoomMembers.get(roomId);
    if (localSids) {
      for (const sid of localSids) {
        seen.add(sid);
      }
    }
    const allSocketIds = Array.from(seen);
    if (allSocketIds.length === 0) {
      console.log(`[PRESENCE_TRACE] getRoomMembers roomId=${roomId} result=[] (no ids)`);
      return [];
    }

    const usersPromises = allSocketIds.map((sid) => getConnectedUser(sid));
    const users = (await Promise.all(usersPromises)).filter((u): u is OnlineUser => u !== undefined);
    console.log(`[PRESENCE_TRACE] getRoomMembers roomId=${roomId} redisCount=${socketIds.length} localCount=${localSids?.size ?? 0} mergedCount=${allSocketIds.length} validUsers=${users.length} socketIds=${JSON.stringify(Array.from(seen))}`);
    return users;
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
    let localCount = localRoomMembers.get(roomId)?.size ?? 0;
    const altRoomId = roomId.startsWith("room:") ? roomId.slice(5) : `room:${roomId}`;
    const altLocalCount = localRoomMembers.get(altRoomId)?.size ?? 0;
    localCount = Math.max(localCount, altLocalCount);

    let viteCount = 0;
    const viteRoomMembersMap = (globalThis as any).__vite_room_members_map__;
    if (viteRoomMembersMap instanceof Map) {
      viteCount = Math.max(
        viteRoomMembersMap.get(roomId)?.size ?? 0,
        viteRoomMembersMap.get(altRoomId)?.size ?? 0
      );
    }

    let adapterCount = 0;
    try {
      const ioInstance = getIOInstance() || (globalThis as any).__socket_io_instance__;
      if (ioInstance?.sockets?.adapter?.rooms) {
        const adapterRooms = ioInstance.sockets.adapter.rooms;
        adapterCount = Math.max(
          adapterRooms.get(`room:${roomId}`)?.size ?? 0,
          adapterRooms.get(roomId)?.size ?? 0
        );
      }
    } catch (_) {}

    const finalCount = Math.max(localCount, viteCount, adapterCount);
    console.log(`[PRESENCE_TRACE] getRoomMemberCount roomId=${roomId} count=${finalCount} (local=${localCount}, vite=${viteCount}, adapter=${adapterCount})`);
    return finalCount;
  }
  try {
    const redisCount = await redis.scard(getRoomKey(roomId));
    const localSids = localRoomMembers.get(roomId);
    const localCount = localSids?.size ?? 0;
    const finalCount = (localSids && localCount > redisCount) ? localCount : redisCount;
    console.log(`[PRESENCE_TRACE] getRoomMemberCount roomId=${roomId} redisCount=${redisCount} localCount=${localCount} finalCount=${finalCount} using=${(localSids && localCount > redisCount) ? 'local' : 'redis'}`);
    return finalCount;
  } catch (err) {
    console.warn("[presence] Redis scard failed, using local memory fallback:", err);
    const count = localRoomMembers.get(roomId)?.size ?? 0;
    console.log(`[PRESENCE_TRACE] getRoomMemberCount roomId=${roomId} count=${count} (fallback after redis error)`);
    return count;
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
      statusFontColor: data.statusFontColor || "",
      messageBubbleStyle: data.messageBubbleStyle,
      roomId: data.roomId,
      connectedAt: data.connectedAt,
      status: (data.status || "online") as any,
      idreg: data.idreg || "",
      siteBadge: data.siteBadge || "",
      statusMsg: data.statusMsg || "",
      giftedBannerUrl: data.giftedBannerUrl || "",
      giftedGiftIconUrl: data.giftedGiftIconUrl || "",
      giftedPromotionIconUrl: data.giftedPromotionIconUrl || "",
      roleIconUrl: data.roleIconUrl || "",
      level: parseInt(data.level, 10) || 1,
      exp: parseInt(data.exp, 10) || 0,
      roomRole: data.roomRole || "member",
      roomPower: parseInt(data.roomPower, 10) || 1000,
      customTitle: data.customTitle || "",
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

// Get Socket.IO instance from global/process reference (works across Vite sandbox boundaries)
function getIOInstance() {
  return (globalThis as any).__socket_io_instance__ || (process as any).__socket_io_instance__ || null;
}

/**
 * دالة مركزية لحساب عدد أعضاء الغرفة وإرسال room_count_update لجميع المتصلين (Fix #7)
 */
export async function emitRoomCount(roomId: string): Promise<void> {
  try {
    const memberCount = await getRoomMemberCount(roomId);
    await publishGlobalEvent("room_count_update", { roomId, memberCount });
  } catch (err) {
    console.error(`[presence] emitRoomCount failed for roomId=${roomId}:`, err);
  }
}

/**
 * التحقق مما إذا كان اسم المستخدم متصلاً حالياً في الدردشة
 */
export async function isUsernameOnline(username: string, excludeSocketId?: string): Promise<boolean> {
  const norm = String(username || "").trim().toLowerCase();
  if (!norm) return false;

  const users = await getAllOnlineUsers();
  const excludeId = String(excludeSocketId || "").trim();

  return users.some((u) => {
    if (excludeId && u.socketId === excludeId) return false;
    const uName = String(u.username || "").trim().toLowerCase();
    return uName === norm;
  });
}

/**
 * إخراج الجلسات السابقة لنفس العضو المسجل عند تسجيل دخوله من نافذة أو جهاز جديد
 */
export async function kickDuplicateUserSockets(userId: string, currentSocketId: string, io: any): Promise<void> {
  if (!userId || userId === "0") return;

  const safeUserId = String(userId).trim();
  const safeCurrentSid = String(currentSocketId).trim();
  const socketsToKick: string[] = [];

  // البحث في الذاكرة المحلية
  for (const [sid, u] of localSockets.entries()) {
    if (sid !== safeCurrentSid && String(u.id).trim() === safeUserId) {
      socketsToKick.push(sid);
    }
  }

  // البحث في Redis إن وُجد
  if (isRedisEnabled) {
    try {
      const socketIds = await redis.smembers(ONLINE_SOCKETS_KEY);
      for (const sid of socketIds) {
        if (sid !== safeCurrentSid && !socketsToKick.includes(sid)) {
          const u = await getConnectedUser(sid);
          if (u && String(u.id).trim() === safeUserId) {
            socketsToKick.push(sid);
          }
        }
      }
    } catch (_) {}
  }

  for (const sid of socketsToKick) {
    try {
      console.log(`[presence] Kicking duplicate session for user ${safeUserId}, old socket ${sid}`);
      const oldSocket = io?.sockets?.sockets?.get?.(sid);
      if (oldSocket) {
        oldSocket.emit("session_replaced", {
          message: "تم تسجيل الدخول بحسابك من صفحة أو جهاز آخر",
        });
        oldSocket.disconnect(true);
      }
      await removeConnectedUser(sid);
    } catch (err) {
      console.error(`[presence] Error kicking duplicate socket ${sid}:`, err);
    }
  }
}

/**
 * تحديث رتبة وأيقونة المستخدم في الحضور وسجلات الاتصال اللحظية فوراً
 */
export async function updateUserRolePresence(userId: string, role: string, roleIconUrl?: string): Promise<void> {
  if (!userId) return;
  const safeId = String(userId).trim().toLowerCase();

  for (const [sid, u] of localSockets.entries()) {
    if (String(u.id).toLowerCase() === safeId || String(u.username).trim().toLowerCase() === safeId) {
      u.role = role;
      if (roleIconUrl !== undefined) {
        u.roleIconUrl = roleIconUrl;
      }
      if (isRedisEnabled) {
        try {
          const key = getSocketKey(sid);
          await redis.hset(key, {
            role: String(role),
            roleIconUrl: String(roleIconUrl ?? u.roleIconUrl ?? ""),
          });
        } catch (_) {}
      }
    }
  }
}



