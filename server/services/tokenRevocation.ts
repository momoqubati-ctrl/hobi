import { dbPool } from "../db";
import { redis, isRedisEnabled } from "./redis";
import { H3Event } from "h3";
import { getClientIp } from "../middleware/rateLimiter";

// 1. Session Revocation: Map<sessionId, expiresAtMs>
const revokedSessions = new Map<string, number>();

// 2. User Revocation: Map<normalizedUsernameOrUserId, revokedAtMs>
const userRevocationTimes = new Map<string, number>();

// 3. IP Revocation: Map<ip, revokedAtMs>
const ipRevocationTimes = new Map<string, number>();

// 4. In-Memory Active Bans Sets
const bannedUsernames = new Set<string>();
const bannedIps = new Set<string>();
const bannedDevices = new Set<string>();

let lastBanSyncTime = 0;
const BAN_CACHE_TTL_MS = 30_000; // 30 seconds

const normalize = (val: string) => val.trim().toLowerCase();

/**
 * إبطال جلسة محددة فوراً (عند تسجيل الخروج)
 */
export function revokeSession(sessionId: string, expiresAt: number) {
  if (!sessionId) return;
  revokedSessions.set(sessionId, expiresAt);

  if (isRedisEnabled) {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    redis.set(`revoked:session:${sessionId}`, "1", "EX", ttlSeconds).catch(() => {});
  }
}

/**
 * إبطال كافة الجلسات الحالية لمستخدم معين (عند الحظر أو إعادة تعيين الأمان)
 */
export function revokeUserTokens(userIdOrUsername: string) {
  if (!userIdOrUsername) return;
  const key = normalize(userIdOrUsername);
  const now = Date.now();
  userRevocationTimes.set(key, now);

  if (isRedisEnabled) {
    redis.set(`revoked:user:${key}`, String(now), "EX", 86400).catch(() => {});
  }
}

/**
 * إبطال التوكنات لعنوان IP محدد
 */
export function revokeIpTokens(ip: string) {
  if (!ip) return;
  const key = ip.trim();
  const now = Date.now();
  ipRevocationTimes.set(key, now);

  if (isRedisEnabled) {
    redis.set(`revoked:ip:${key}`, String(now), "EX", 86400).catch(() => {});
  }
}

/**
 * فحص ما إذا كان التوكن أو الجلسة مبطلة
 */
export function isTokenRevoked(params: {
  sessionId?: string;
  userId?: string;
  username?: string;
  iat?: number;
}): boolean {
  const now = Date.now();

  // 1. فحص الجلسة الفردية
  if (params.sessionId) {
    const exp = revokedSessions.get(params.sessionId);
    if (exp && exp > now) {
      return true;
    }
  }

  // 2. فحص إبطال كافة توكنات المستخدم السابقة
  const iat = params.iat || 0;
  if (params.username) {
    const userRevokedAt = userRevocationTimes.get(normalize(params.username));
    if (userRevokedAt && iat <= userRevokedAt) {
      return true;
    }
  }

  if (params.userId) {
    const userIdRevokedAt = userRevocationTimes.get(normalize(params.userId));
    if (userIdRevokedAt && iat <= userIdRevokedAt) {
      return true;
    }
  }

  return false;
}

/**
 * تسجيل حظر فوري في كاش الذاكرة
 */
export function recordBanInCache(params: {
  targetName?: string;
  type?: string;
  ip?: string;
  deviceFingerprint?: string;
  deviceSignature?: string;
}) {
  if (params.targetName && (params.type === "name" || !params.type)) {
    bannedUsernames.add(normalize(params.targetName));
  }
  if (params.ip) {
    bannedIps.add(params.ip.trim());
  }
  if (params.deviceFingerprint) {
    bannedDevices.add(params.deviceFingerprint.trim());
  }
  if (params.deviceSignature) {
    bannedDevices.add(params.deviceSignature.trim());
  }
}

/**
 * إزالة حظر من كاش الذاكرة
 */
export function removeBanFromCache(targetName: string, banType?: string) {
  if (!targetName) return;
  if (banType === "ip") {
    bannedIps.delete(targetName.trim());
  } else if (banType === "device") {
    bannedDevices.delete(targetName.trim());
  } else {
    bannedUsernames.delete(normalize(targetName));
  }
}

/**
 * فحص فوري وسريع في الذاكرة عما إذا كان المستخدم أو الـ IP محظوراً حالياً
 */
export function isUserActivelyBanned(params: {
  username?: string;
  userId?: string;
  event?: H3Event;
  ip?: string;
}): boolean {
  // فحص بالاسم
  if (params.username) {
    const norm = normalize(params.username);
    if (bannedUsernames.has(norm)) {
      return true;
    }
  }

  // فحص بالـ IP
  const clientIp = params.ip || (params.event ? getClientIp(params.event) : undefined);
  if (clientIp) {
    if (bannedIps.has(clientIp.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * مزامنة قائمة المحظورين من قاعدة البيانات إلى الذاكرة دورياً
 */
export async function syncBansFromDatabase(): Promise<void> {
  const now = Date.now();
  if (now - lastBanSyncTime < BAN_CACHE_TTL_MS) return;
  lastBanSyncTime = now;

  try {
    const result = await dbPool.query(
      `SELECT target_name, ban_type, ip_address, device_fingerprint, device_signature
       FROM moderation_bans
       WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())`
    );

    const newUsernames = new Set<string>();
    const newIps = new Set<string>();
    const newDevices = new Set<string>();

    for (const row of result.rows) {
      if (row.ban_type === "name" && row.target_name) {
        newUsernames.add(normalize(row.target_name));
      } else if (row.ban_type === "ip" && row.ip_address) {
        newIps.add(row.ip_address.trim());
      } else if (row.ban_type === "device") {
        if (row.device_fingerprint) newDevices.add(row.device_fingerprint.trim());
        if (row.device_signature) newDevices.add(row.device_signature.trim());
      }
    }

    bannedUsernames.clear();
    for (const u of newUsernames) bannedUsernames.add(u);
    bannedIps.clear();
    for (const ip of newIps) bannedIps.add(ip);
    bannedDevices.clear();
    for (const d of newDevices) bannedDevices.add(d);
  } catch (err) {
    console.error("[tokenRevocation] Failed to sync bans from database:", err);
  }
}

// تنظيف دوري للذاكرة من الجلسات المنتهية كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, exp] of revokedSessions.entries()) {
    if (exp <= now) {
      revokedSessions.delete(sessionId);
    }
  }
}, 10 * 60 * 1000).unref?.();

// مزامنة مبدئية عند التحميل
syncBansFromDatabase().catch(() => {});
