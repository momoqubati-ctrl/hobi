import test from "node:test";
import assert from "node:assert";
import { isStoriesEnabled } from "../server/services/storyService";

test("StoryService - isStoriesEnabled returns boolean without error", async () => {
  const enabled = await isStoriesEnabled();
  assert.strictEqual(typeof enabled, "boolean");
});

test("Stories Logic - first unviewed story detection and ring state", () => {
  type StoryItem = {
    id: string;
    authorId: string;
    viewedByMe: boolean;
    createdAt: string;
  };

  const stories: StoryItem[] = [
    { id: "s1", authorId: "user1", viewedByMe: true, createdAt: "2026-10-29T10:00:00Z" },
    { id: "s2", authorId: "user1", viewedByMe: true, createdAt: "2026-10-29T11:00:00Z" },
    { id: "s3", authorId: "user1", viewedByMe: false, createdAt: "2026-10-29T12:00:00Z" },
    { id: "s4", authorId: "user1", viewedByMe: false, createdAt: "2026-10-29T13:00:00Z" },
  ];

  // 1. Sort chronological
  const userStories = stories
    .filter((s) => s.authorId === "user1")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // 2. Find first unviewed story index
  const firstUnviewed = userStories.findIndex((s) => !s.viewedByMe);
  assert.strictEqual(firstUnviewed, 2, "Should start at index 2 (the 3rd story) without repeating s1 and s2");

  // 3. Ring glowing state: hasUnviewed should be true
  const hasUnviewed = userStories.some((s) => !s.viewedByMe);
  assert.strictEqual(hasUnviewed, true, "Ring should be glowing when at least one story is unviewed");

  // 4. When all stories are watched
  userStories[2].viewedByMe = true;
  userStories[3].viewedByMe = true;
  const allViewedFirstIndex = userStories.findIndex((s) => !s.viewedByMe);
  const targetWhenAllViewed = allViewedFirstIndex !== -1 ? allViewedFirstIndex : 0;
  assert.strictEqual(targetWhenAllViewed, 0, "Should open at index 0 when all stories are watched");

  const hasUnviewedAfterAll = userStories.some((s) => !s.viewedByMe);
  assert.strictEqual(hasUnviewedAfterAll, false, "Ring should turn gray when all stories are viewed");

  // 5. When a 5th story is added
  userStories.push({ id: "s5", authorId: "user1", viewedByMe: false, createdAt: "2026-10-29T14:00:00Z" });
  const hasUnviewedWithNewStory = userStories.some((s) => !s.viewedByMe);
  assert.strictEqual(hasUnviewedWithNewStory, true, "Ring must return to glowing when a new unviewed story is added");

  const newTargetIndex = userStories.findIndex((s) => !s.viewedByMe);
  assert.strictEqual(newTargetIndex, 4, "Should open directly at index 4 (the newly added story)");
});
