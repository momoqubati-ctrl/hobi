import { defineEventHandler, getRequestHeader, setResponseStatus, setResponseHeader, H3Event } from "h3";
import { isRedisEnabled, redis } from "../services/redis";

interface RateLimitConfig {
  max: number;
  windowMs: number;
}

const LIMITS: Record<string, RateLimitConfig> = {
  auth: { max: 20, windowMs: 60 * 1000 },       // 20 requests per minute for auth
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

function getClientIp(event: H3Event): string {
  const cfIp = getRequestHeader(event, "cf-connecting-ip");
  if (cfIp && typeof cfIp === "string") return cfIp.trim();

  const forwarded = getRequestHeader(event, "x-forwarded-for");
  if (forwarded && typeof forwarded === "string") {
    const first = forwarded.split(",")[0];
    if (first && first.trim()) return first.trim();
  }

  const realIp = getRequestHeader(event, "x-real-ip");
  if (realIp && typeof realIp === "string") return realIp.trim();

  return event.node?.req?.socket?.remoteAddress || "127.0.0.1";
}

function getRouteCategory(path: string): string | null {
  // لا تطبق Rate Limiting على استعلامات الفحص اللحظية أو الملفات الثابتة
  if (!path.startsWith("/api/")) return null;
  if (path === "/api/health" || path.startsWith("/api/health/")) return null;

  if (path.startsWith("/api/auth/")) return "auth";
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
