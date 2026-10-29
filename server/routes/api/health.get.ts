import { defineEventHandler } from "h3";
import { checkDatabaseConnection } from "../../db";
import { isRedisEnabled, redis } from "../../services/redis";

export default defineEventHandler(async () => {
  const database = await checkDatabaseConnection();

  let redisOk = false;
  if (isRedisEnabled && redis && typeof redis.ping === "function") {
    try {
      const pong = await Promise.race([
        redis.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
      redisOk = pong === "PONG";
    } catch {
      redisOk = false;
    }
  }

  return {
    ok: true,
    service: "global-chat",
    status: "ready",
    database,
    redis: {
      enabled: isRedisEnabled,
      connected: redisOk,
    },
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
});
