import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
const redisEnabled = process.env.REDIS_ENABLED === "true" || Boolean(redisUrl);
const resolvedRedisUrl = redisUrl || "redis://localhost:6379";

type RedisCommandClient = {
  del: (...args: any[]) => Promise<number>;
  eval: (script: string, numberOfKeys: number, ...args: any[]) => Promise<string | number>;
  expire: (...args: any[]) => Promise<number>;
  get: (...args: any[]) => Promise<string | null>;
  hgetall: (...args: any[]) => Promise<Record<string, string>>;
  hincrby: (...args: any[]) => Promise<number>;
  hset: (...args: any[]) => Promise<number>;
  incr: (...args: any[]) => Promise<number>;
  incrby: (...args: any[]) => Promise<number>;
  keys: (...args: any[]) => Promise<string[]>;
  lpush: (...args: any[]) => Promise<number>;
  ltrim: (...args: any[]) => Promise<string>;
  publish: (...args: any[]) => Promise<number>;
  rpush: (...args: any[]) => Promise<number>;
  set: (...args: any[]) => Promise<string | null>;
  xadd: (...args: any[]) => Promise<string | null>;
  zadd: (...args: any[]) => Promise<number>;
  zincrby: (...args: any[]) => Promise<string>;
  zrevrange: (...args: any[]) => Promise<string[]>;
  sadd: (...args: any[]) => Promise<number>;
  srem: (...args: any[]) => Promise<number>;
  smembers: (...args: any[]) => Promise<string[]>;
  scard: (...args: any[]) => Promise<number>;
  ttl: (...args: any[]) => Promise<number>;
};

function createNoopRedis(): RedisCommandClient {
  return {
    del: async () => 0,
    eval: async () => {
      throw new Error("Redis is disabled");
    },
    expire: async () => 0,
    get: async () => null,
    hgetall: async () => ({}),
    hincrby: async () => 0,
    hset: async () => 0,
    incr: async () => 1,
    incrby: async () => 0,
    keys: async () => [],
    lpush: async () => 0,
    ltrim: async () => "OK",
    publish: async () => 0,
    rpush: async () => 0,
    set: async () => "OK",
    xadd: async () => null,
    zadd: async () => 0,
    zincrby: async () => "0",
    zrevrange: async () => [],
    sadd: async () => 0,
    srem: async () => 0,
    smembers: async () => [],
    scard: async () => 0,
    ttl: async () => -2,
  };
}

export function createRedisClient(): RedisCommandClient {
  if (!redisEnabled) {
    return createNoopRedis();
  }

  const maxConnectRetries = Number(process.env.REDIS_CONNECT_RETRIES ?? 3);
  let lastErrorMessage = "";
  let lastErrorAt = 0;

  const client = new Redis(resolvedRedisUrl, {
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 1000),
    enableOfflineQueue: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: Number(process.env.REDIS_MAX_RETRIES_PER_REQUEST ?? 1),
    retryStrategy(times) {
      if (times > maxConnectRetries) return null;
      return Math.min(times * 250, 1000);
    },
  });

  client.on("error", (error) => {
    const now = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastErrorMessage || now - lastErrorAt > 30000) {
      console.warn(`[redis] ${message}`);
      lastErrorMessage = message;
      lastErrorAt = now;
    }
  });

  client.on("end", () => {
    if (process.env.REDIS_REQUIRED === "true") {
      console.warn("[redis] connection ended");
    }
  });

  return client;
}

export const redis = createRedisClient();
export const isRedisEnabled = redisEnabled;

/**
 * مفاتيح Redis الموحدة
 */
export const KEYS = {
  presence: (userId: string) => `presence:${userId}`,
  presenceSignals: (userId: string) => `presence:signals:${userId}`,
  roomState: (roomId: string) => `room:state:${roomId}`,
  roomMembers: (roomId: string) => `room:members:${roomId}`,
  roomChannel: (roomId: string) => `channel:room:${roomId}`,
  socialChannel: (userId: string) => `channel:social:${userId}`,
  moderationQueue: "queue:moderation",
  workerQueue: (worker: string) => `queue:worker:${worker}`,
  typing: (roomId: string) => `typing:${roomId}`,
  socialGraph: (userId: string) => `social:graph:${userId}`,
  interactionGraph: (userId: string) => `social:interaction:${userId}`,
  counters: (type: string) => `counters:${type}`,
  feedCache: (userId: string) => `feed:cache:${userId}`,
  rankingCache: (scope: string) => `ranking:${scope}`,
  recommendationCache: (userId: string) => `recommendation:cache:${userId}`,
  permissions: (userId: string) => `permissions:${userId}`,
};

/**
 * تحديث الحضور الذكي
 */
export const updatePresence = async (userId: string, data: {
  status: string;
  activity?: string;
  roomId?: string;
  device?: string;
}) => {
  const key = KEYS.presence(userId);
  await redis.hset(key, {
    ...data,
    lastSeen: Date.now(),
  });
  await redis.expire(key, 300); // تنتهي الصلاحية بعد 5 دقائق من الخمول
};

/**
 * جلب حالة الغرفة اللحظية
 */
export const getRoomLiveState = async (roomId: string) => {
  const key = KEYS.roomState(roomId);
  return await redis.hgetall(key);
};

export default redis;
