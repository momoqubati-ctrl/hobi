import assert from "node:assert/strict";
import test from "node:test";
import {
  getAllowedAnnouncementTypes,
  getAnnouncementSubmissionKey,
  canReceiveAnnouncementsForRole,
  listPendingAnnouncements,
  sendAnnouncement,
  validateAnnouncementDraft,
  type AnnouncementDraft,
} from "../src/lib/announcements";

test("announcement type options only include the user's explicit permissions", () => {
  assert.deepEqual(
    getAllowedAnnouncementTypes(["announcement_ranked.use", "announcement_room.use"]),
    ["ranked", "room"],
  );
  assert.deepEqual(getAllowedAnnouncementTypes([]), []);
});

test("announcement inbox is reserved for authenticated non-guest roles", () => {
  assert.equal(canReceiveAnnouncementsForRole("guest"), false);
  assert.equal(canReceiveAnnouncementsForRole(" guest "), false);
  assert.equal(canReceiveAnnouncementsForRole("member"), true);
  assert.equal(canReceiveAnnouncementsForRole("  "), false);
  assert.equal(canReceiveAnnouncementsForRole(undefined), false);
});

test("announcement drafts reject blank, oversized, and room-less content", () => {
  assert.equal(validateAnnouncementDraft({ type: "all", message: "  " }), "اكتب نص الإعلان");
  assert.equal(validateAnnouncementDraft({ type: "all", message: "أ".repeat(1001) }), "الحد الأقصى للإعلان 1000 حرف");
  assert.equal(validateAnnouncementDraft({ type: "room", message: "إعلان" }), "اختر غرفة للإعلان");
  assert.equal(validateAnnouncementDraft({ type: "room", roomId: "room-1", message: "إعلان" }), null);
});

test("announcement retries reuse a key only while the intended draft is unchanged", () => {
  const draft: AnnouncementDraft = { type: "all", message: "إعلان" };
  const first = getAnnouncementSubmissionKey(draft, null, () => "key-1");

  assert.equal(getAnnouncementSubmissionKey(draft, first, () => "key-2").key, "key-1");
  assert.equal(
    getAnnouncementSubmissionKey({ ...draft, message: "إعلان آخر" }, first, () => "key-3").key,
    "key-3",
  );
});

test("sending an announcement includes the idempotency key and only the selected audience fields", async () => {
  const draft: AnnouncementDraft = { type: "room", roomId: "room-1", message: "إعلان الغرفة" };
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const receipt = { success: true, id: "announcement-1", recipientCount: 2, sentToday: 1, dailyLimit: 5, remainingToday: 4 };

  const result = await sendAnnouncement(draft, "request-key", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(receipt), { status: 201 });
  });

  assert.equal(requestUrl, "/api/announcements");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("Idempotency-Key"), "request-key");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), draft);
  assert.equal(result.id, "announcement-1");
});

test("pending announcement requests preserve pagination and report API errors", async () => {
  let requestUrl = "";
  const page = { success: true, items: [], nextCursor: null };
  await listPendingAnnouncements("cursor + next", async (input) => {
    requestUrl = String(input);
    return new Response(JSON.stringify(page), { status: 200 });
  });
  assert.match(requestUrl, /cursor=cursor\+%2B\+next/);
  assert.match(requestUrl, /limit=50/);

  await assert.rejects(
    sendAnnouncement({ type: "all", message: "إعلان" }, "request-key", async () =>
      new Response(JSON.stringify({ success: false, message: "تجاوزت الحد اليومي" }), { status: 429 }),
    ),
    /تجاوزت الحد اليومي/,
  );
});
