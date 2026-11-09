import { defineEventHandler, getRequestHeader, setResponseStatus, setResponseHeader, H3Event } from "h3";
import { isRedisEnabled, redis } from "../services/redis";

interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export const LIMITS: Record<string, RateLimitConfig> = {
  auth: { max: 20, windowMs: 60 * 1000 },       // 20 requests per minute for auth
  hosting_owner_auth: { max: 10, windowMs: 15 * 60 * 1000 },
  upload: { max: 30, windowMs: 60 * 1000 },     // 30 uploads per minute
  default: { max: 180, windowMs: 60 * 1000 },   // 180 general API requests per minute
};

// ذاكرة تخزين محلية في حال عدم توفر Redis (مع تنظيف دوري للذاكرة)
const memoryStore = new Map<string, { count: number; resetAt: number }>();

// تنظيف السجلات منتهية الصلاحية كل دقيقة لمنع تراكم الذاكرة
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (record.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 60 * 1000);

if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

const PRIVATE_IP_REGEX = /^(::f{4}:)?(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|fc00:|fe80:|::1$|localhost)/i;

/**
 * يتحقق مما إذا كان الاتصال قادماً من وكيل عكسي موثوق (مثل Nginx أو Cloudflare على الشبكة الداخلية)
 */
export function isTrustedProxy(remoteAddress: string): boolean {
  if (!remoteAddress) return false;
  if (process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1") {
    return true;
  }
  const clean = remoteAddress.replace(/^::ffff:/, "").trim();
  const configured = (process.env.TRUSTED_PROXIES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (configured.includes(clean)) return true;

  return PRIVATE_IP_REGEX.test(remoteAddress.trim());
}

/**
 * يستخرج عنوان IP الحقيقي بأمان لمنع التزييف عبر ترويسات X-Forwarded-For أو CF-Connecting-IP غير الموثوقة
 */
export function getClientIp(event: H3Event): string {
  const remoteAddress =
    event.node?.req?.socket?.remoteAddress ||
    (event as any).req?.socket?.remoteAddress ||
    (event.context as any)?.clientAddress ||
    "";
  const cleanRemote = remoteAddress.replace(/^::ffff:/, "").trim();

  // لا نثق بالترويسات إلا إذا جاء الاتصال من خادم وكيل موثوق
  if (isTrustedProxy(remoteAddress)) {
    const cfIp = getRequestHeader(event, "cf-connecting-ip");
    if (typeof cfIp === "string" && cfIp.trim() && /^[a-fA-F0-9:.]+$/.test(cfIp.trim())) {
      return cfIp.trim().replace(/^::ffff:/, "");
    }

    const realIp = getRequestHeader(event, "x-real-ip");
    if (typeof realIp === "string" && realIp.trim() && /^[a-fA-F0-9:.]+$/.test(realIp.trim())) {
      return realIp.trim().replace(/^::ffff:/, "");
    }

    const forwarded = getRequestHeader(event, "x-forwarded-for");
    if (typeof forwarded === "string" && forwarded.trim()) {
      const parts = forwarded
        .split(",")
        .map((p) => p.trim().replace(/^::ffff:/, ""))
        .filter((p) => /^[a-fA-F0-9:.]+$/.test(p));
      if (parts.length > 0 && parts[0]) {
        return parts[0];
      }
    }
  }

  // في حال الاتصال المباشر غير الموثوق، يُعتمد عنوان المقبس الفعلي دائماً
  return cleanRemote || "127.0.0.1";
}

export function getRouteCategory(path: string): string | null {
  // لا تطبق Rate Limiting على استعلامات الفحص اللحظية أو الملفات الثابتة
  if (!path.startsWith("/api/")) return null;
  if (path === "/api/health" || path.startsWith("/api/health/")) return null;

  if (path === "/api/hosting-owner/auth/login") return "hosting_owner_auth";
  if (path.startsWith("/api/auth/") || path.startsWith("/api/auth.")) return "auth";
  if (path.startsWith("/api/agents/auth/")) return "auth";
  if (path.includes("/upload") || path.startsWith("/api/wall/upload")) return "upload";

  return "default";
}

export default defineEventHandler(async (event) => {
  const path = event.path || "";
  const category = getRouteCategory(path);
  if (!category) return;

  const clientIp = getClientIp(event);
  event.context.clientIp = clientIp;

  const config = LIMITS[category] || LIMITS.default;
  const now = Date.now();
  let currentCount = 1;
  let resetInSeconds = Math.ceil(config.windowMs / 1000);

  // 1. استخدام Redis إن كان مفعلاً ومتصلاً
  if (isRedisEnabled && redis && typeof redis.incr === "function") {
    try {
      const redisKey = `ratelimit:${category}:${clientIp}`;
      const count = await redis.incr(redisKey);
      if (Number(count) === 1) {
        await redis.expire(redisKey, Math.ceil(config.windowMs / 1000));
      }
      currentCount = Number(count);
      const ttl = await redis.ttl(redisKey);
      if (ttl > 0) resetInSeconds = ttl;
    } catch {
      // في حال تعذر Redis ننتقل تلقائياً للذاكرة المحلية
      currentCount = checkInMemory(category, clientIp, config, now);
    }
  } else {
    if (process.env.NODE_ENV === "production" && process.env.REDIS_REQUIRED === "true") {
      console.warn("[RateLimiter] Redis is required in production but unavailable. Falling back to local store.");
    }
    // 2. استخدام التخزين المحلي الآمن (In-Memory Sliding Window)
    currentCount = checkInMemory(category, clientIp, config, now);
  }

  // إضافة ترويسات المعدل القياسية (Standard RateLimit Headers)
  setResponseHeader(event, "X-RateLimit-Limit", String(config.max));
  setResponseHeader(event, "X-RateLimit-Remaining", String(Math.max(0, config.max - currentCount)));

  if (currentCount > config.max) {
    setResponseStatus(event, 429);
    setResponseHeader(event, "Retry-After", String(resetInSeconds));
    return {
      success: false,
      code: "TOO_MANY_REQUESTS",
      message: "تم تجاوز الحد المسموح من الطلبات. يرجى الانتظار قليلاً ثم المحاولة مجدداً.",
      retryAfterSeconds: resetInSeconds,
    };
  }
});

function checkInMemory(category: string, ip: string, config: RateLimitConfig, now: number): number {
  const key = `${category}:${ip}`;
  const existing = memoryStore.get(key);

  if (!existing || existing.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return 1;
  }

  existing.count += 1;
  return existing.count;
}
