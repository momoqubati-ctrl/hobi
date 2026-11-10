import assert from "node:assert/strict";
import test from "node:test";
import { getCachedProfileStats, mergeProfileStats } from "../server/services/profileStatsCache";

test("partial Redis profile stats are not treated as a complete cache hit", () => {
  const cached = { views: "12" };

  assert.equal(getCachedProfileStats(cached), null);
});

test("cached profile stat fields override the database fallback independently", () => {
  const merged = mergeProfileStats(
    { views: 10, likes: 20, coins: 30, evaluation: 40, giftsReceivedCount: 50 },
    { views: "12", likes: "22" },
  );

  assert.deepEqual(merged, {
    views: 12,
    likes: 22,
    coins: 30,
    evaluation: 40,
    giftsReceivedCount: 50,
  });
});

test("complete Redis profile stats can be returned without a database fallback", () => {
  assert.deepEqual(
    getCachedProfileStats({
      views: "1",
      likes: "2",
      coins: "3",
      evaluation: "4",
      giftsReceivedCount: "5",
    }),
    { views: 1, likes: 2, coins: 3, evaluation: 4, giftsReceivedCount: 5 },
  );
});
