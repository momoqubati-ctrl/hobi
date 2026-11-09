import assert from "node:assert/strict";
import {
  getResponseStatus,
  mockEvent,
} from "h3";
import test from "node:test";
import { createAnnouncementSendHandler } from "../server/routes/api/announcements/index.post";
import { issueToken } from "../server/services/authService";
import {
  AnnouncementDeliveryError,
  type AnnouncementReceipt,
  type SendAnnouncementInput,
} from "../server/services/announcementDelivery";

const idempotencyKey = "00000000-0000-4000-8000-000000000001";
const receipt: AnnouncementReceipt = {
  id: "announcement-1",
  recipientCount: 2,
  sentToday: 1,
  dailyLimit: 5,
  remainingToday: 4,
};

function createEvent(options: {
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
} = {}) {
  return mockEvent("/api/announcements", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify(options.body ?? {}),
  });
}

test("announcement sending requires a verified non-guest member session", async () => {
  let calls = 0;
  const handler = createAnnouncementSendHandler(async () => {
    calls += 1;
    return receipt;
  });

  const invalidSession = createEvent({ body: { type: "all", message: "hello" }, idempotencyKey });
  await handler(invalidSession);
  assert.equal(getResponseStatus(invalidSession), 401);

  const guestSession = createEvent({
    body: { type: "all", message: "hello" },
    token: issueToken({ id: "guest-1", username: "guest", role: "guest" }),
    idempotencyKey,
  });
  await handler(guestSession);
  assert.equal(getResponseStatus(guestSession), 403);
  assert.equal(calls, 0);
});

test("announcement sending rejects malformed, mismatched and identity-spoofing bodies", async () => {
  let calls = 0;
  const handler = createAnnouncementSendHandler(async () => {
    calls += 1;
    return receipt;
  });
  const token = issueToken({ id: "member-7", username: "member-seven", role: "member" });

  for (const body of [
    { type: "other", message: "hello" },
    { type: "room", message: "hello" },
    { type: "all", message: "hello", roomId: "room-1" },
    { type: "all", message: "hello", senderUserId: "victim" },
    { type: "all", message: "hello", recipientIds: ["victim"] },
  ]) {
    const event = createEvent({ body, token, idempotencyKey });
    await handler(event);
    assert.equal(getResponseStatus(event), 422);
  }
  const missingKey = createEvent({
    body: { type: "all", message: "hello" },
    token,
  });
  await handler(missingKey);
  assert.equal(getResponseStatus(missingKey), 422);
  assert.equal(calls, 0);
});

test("announcement sending derives sender from the session and returns the receipt", async () => {
  let receivedInput: SendAnnouncementInput | undefined;
  const handler = createAnnouncementSendHandler(async (input) => {
    receivedInput = input;
    return receipt;
  });
  const token = issueToken({ id: "member-7", username: "member-seven", role: "member" });
  const event = createEvent({
    body: { type: "room", message: "  hello  ", roomId: "room-slug" },
    token,
    idempotencyKey,
  });

  const response = await handler(event);

  assert.deepEqual(receivedInput, {
    senderUserId: "member-7",
    senderUsername: "member-seven",
    type: "room",
    message: "  hello  ",
    roomId: "room-slug",
    idempotencyKey,
  });
  assert.deepEqual(response, { success: true, ...receipt });
  assert.equal(getResponseStatus(event), 201);
});

test("announcement API maps permission, room, quota and idempotency errors", async () => {
  const token = issueToken({ id: "member-7", username: "member-seven", role: "member" });
  const cases: Array<{
    code: ConstructorParameters<typeof AnnouncementDeliveryError>[0];
    status: number;
  }> = [
    { code: "NOT_ALLOWED", status: 403 },
    { code: "ROOM_NOT_FOUND", status: 404 },
    { code: "DAILY_LIMIT_EXCEEDED", status: 429 },
    { code: "IDEMPOTENCY_CONFLICT", status: 409 },
    { code: "INVALID_REQUEST", status: 422 },
  ];

  for (const item of cases) {
    const handler = createAnnouncementSendHandler(async () => {
      throw new AnnouncementDeliveryError(item.code, "internal detail");
    });
    const event = createEvent({
      body: { type: "all", message: "hello" },
      token,
      idempotencyKey,
    });
    const response = await handler(event) as { success: boolean; message: string };

    assert.equal(getResponseStatus(event), item.status);
    assert.equal(response.success, false);
    assert.notEqual(response.message, "internal detail");
  }
});
