import { redis } from "../services/redis";

export type MetricTags = Record<string, string | number | boolean | undefined>;

function tagSuffix(tags?: MetricTags): string {
  if (!tags) return "";
  return Object.entries(tags)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

// Lua script: يدمج INCRBY + EXPIRE في round-trip واحد بدلاً من اثنين
const LUA_INCRBY_EXPIRE = `
local v = redis.call("INCRBY", KEYS[1], ARGV[1])
if tonumber(ARGV[2]) == 1 or v == tonumber(ARGV[1]) then
  redis.call("EXPIRE", KEYS[1], ARGV[3])
end
return v
`;

// Lua script: يدمج LPUSH + LTRIM + EXPIRE في round-trip واحد
const LUA_TIMING = `
redis.call("LPUSH", KEYS[1], ARGV[1])
redis.call("LTRIM", KEYS[1], 0, 999)
redis.call("EXPIRE", KEYS[1], ARGV[2])
return 1
`;

export class Metrics {
  async increment(name: string, value = 1, tags?: MetricTags): Promise<void> {
    const suffix = tagSuffix(tags);
    const key = suffix ? `metrics:${name}:${suffix}` : `metrics:${name}`;
    // Lua script: INCRBY + EXPIRE في round-trip واحد (بدلاً من 2 round-trips)
    await redis.eval(LUA_INCRBY_EXPIRE, 1, key, String(value), "1", "86400").catch(() => undefined);
  }

  async timing(name: string, durationMs: number, tags?: MetricTags): Promise<void> {
    const suffix = tagSuffix(tags);
    const key = suffix ? `metrics:${name}:${suffix}` : `metrics:${name}`;
    // Lua script: LPUSH + LTRIM + EXPIRE في round-trip واحد (بدلاً من 3 round-trips)
    await redis.eval(LUA_TIMING, 1, key, String(Math.max(0, Math.round(durationMs))), "86400").catch(() => undefined);
  }
}

export const metrics = new Metrics();
