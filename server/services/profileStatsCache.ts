export interface ProfileStatsSnapshot {
  views: number;
  likes: number;
  coins: number;
  evaluation: number;
  giftsReceivedCount: number;
}

export type CachedProfileStats = Partial<Record<keyof ProfileStatsSnapshot, string>>;

const STAT_FIELDS: (keyof ProfileStatsSnapshot)[] = [
  "views",
  "likes",
  "coins",
  "evaluation",
  "giftsReceivedCount",
];

const parseCachedValue = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function getCachedProfileStats(
  cached: CachedProfileStats | null | undefined,
): ProfileStatsSnapshot | null {
  if (!cached || STAT_FIELDS.some((field) => cached[field] === undefined)) return null;

  const stats = mergeProfileStats(
    { views: 0, likes: 0, coins: 0, evaluation: 0, giftsReceivedCount: 0 },
    cached,
  );
  return STAT_FIELDS.every((field) => Number.isFinite(stats[field])) ? stats : null;
}

export function mergeProfileStats(
  fallback: ProfileStatsSnapshot,
  cached: CachedProfileStats | null | undefined,
): ProfileStatsSnapshot {
  return {
    views: parseCachedValue(cached?.views, fallback.views),
    likes: parseCachedValue(cached?.likes, fallback.likes),
    coins: parseCachedValue(cached?.coins, fallback.coins),
    evaluation: parseCachedValue(cached?.evaluation, fallback.evaluation),
    giftsReceivedCount: parseCachedValue(cached?.giftsReceivedCount, fallback.giftsReceivedCount),
  };
}
