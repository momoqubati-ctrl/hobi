import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAllPendingAnnouncements,
  mergePendingAnnouncements,
  removePendingAnnouncement,
} from "../src/lib/announcementInbox";
import type { PendingAnnouncement, PendingAnnouncementPage } from "../src/lib/announcements";

const announcement = (
  id: string,
  createdAt: string,
): PendingAnnouncement => ({
  id,
  type: "all",
  message: `message ${id}`,
  senderName: "sender",
  senderAvatarUrl: null,
  createdAt,
});

test("pending announcements merge once in FIFO order and ignore dismissed ids", () => {
  const first = announcement("first", "2026-01-01T10:00:00.000Z");
  const second = announcement("second", "2026-01-01T10:01:00.000Z");
  const dismissed = announcement("dismissed", "2026-01-01T10:02:00.000Z");
  const merged = mergePendingAnnouncements(
    [second, dismissed],
    [first, { ...second, message: "duplicate" }, dismissed],
    new Set(["dismissed"]),
  );

  assert.deepEqual(merged.map(({ id }) => id), ["first", "second"]);
  assert.equal(merged[1].message, "duplicate");
  assert.deepEqual(removePendingAnnouncement(merged, "first").map(({ id }) => id), ["second"]);
});

test("pending announcement loader follows every cursor and rejects cursor cycles", async () => {
  const pages = new Map<string, PendingAnnouncementPage>([
    ["start", { items: [announcement("first", "2026-01-01T10:00:00.000Z")], nextCursor: "next" }],
    ["next", { items: [announcement("second", "2026-01-01T10:01:00.000Z")], nextCursor: null }],
  ]);
  const cursors: Array<string | null> = [];
  const loaded = await loadAllPendingAnnouncements(async (cursor) => {
    cursors.push(cursor);
    const key = cursor ?? "start";
    const page = pages.get(key);
    if (!page) throw new Error("unexpected cursor");
    return page;
  });

  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(loaded.map(({ id }) => id), ["first", "second"]);
  await assert.rejects(
    loadAllPendingAnnouncements(async () => ({
      items: [],
      nextCursor: "same-cursor",
    })),
    /تعذر تحميل جميع الإعلانات/,
  );
});
