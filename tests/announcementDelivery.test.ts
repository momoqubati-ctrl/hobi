import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AnnouncementDeliveryError,
  createAnnouncementRequestFingerprint,
  getRiyadhUsageDate,
  sendAnnouncement,
  type AnnouncementDeliveryDependencies,
  type SendAnnouncementInput,
} from "../server/services/announcementDelivery";

const now = new Date("2026-10-31T12:00:00.000Z");
const validInput: SendAnnouncementInput = {
  senderUserId: "sender-1",
  senderUsername: "sender",
  type: "all",
  message: "  تنبيه مهم  ",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
};

function fingerprintFor(input: SendAnnouncementInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      type: input.type,
      message: input.message.trim(),
      roomId: input.roomId?.trim() ?? null,
    }))
    .digest("hex");
}

function createDeliveryDependencies(options: {
  dailyLimit?: number;
  usageCount?: number;
  recipients?: string[];
  existingIdempotency?: { fingerprint: string; response: unknown; expiresAt: Date };
  lockAcquired?: boolean;
  failOn?: string;
} = {}) {
  const statements: string[] = [];
  const published: Array<{ userId: string; event: string; payload: unknown }> = [];
  let sendCount = options.usageCount ?? 0;
  let releaseCount = 0;
  const dependencies: AnnouncementDeliveryDependencies = {
    connect: async () => ({
      async query(text: string, values: unknown[] = []) {
        statements.push(text);
        if (options.failOn && text.includes(options.failOn)) {
          throw new Error("simulated database failure");
        }
        if (text.includes("pg_try_advisory_xact_lock")) {
          return { rows: [{ acquired: options.lockAcquired ?? true }] };
        }
        if (text.includes("FROM announcement_idempotency")) {
          if (!options.existingIdempotency) return { rows: [] };
          return {
            rows: [{
              request_fingerprint: options.existingIdempotency.fingerprint,
              response: options.existingIdempotency.response,
              expires_at: options.existingIdempotency.expiresAt,
            }],
          };
        }
        if (text.includes("FROM users u")) {
          return {
            rows: [{
              username: "sender",
              sender_name: "مرسل الإعلان",
              sender_avatar_url: "https://cdn.example/avatar.png",
            }],
          };
        }
        if (text.includes("INSERT INTO announcement_daily_usage")) {
          return { rows: [] };
        }
        if (text.includes("UPDATE announcement_daily_usage")) {
          const dailyLimit = Number(values[2]);
          if (sendCount >= dailyLimit) return { rows: [] };
          sendCount += 1;
          return { rows: [{ send_count: sendCount }] };
        }
        if (text.includes("INSERT INTO announcements")) {
          return {
            rows: [{
              id: "announcement-1",
              created_at: new Date("2026-10-31T12:00:00.000Z"),
            }],
          };
        }
        if (text.includes("INSERT INTO announcement_recipients")) {
          return { rows: [] };
        }
        if (text.includes("INSERT INTO announcement_idempotency")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {
        releaseCount += 1;
      },
    } as never),
    resolvePolicy: async () => ({
      allowedTypes: ["all"],
      dailyLimit: options.dailyLimit ?? 2,
    }),
    resolveAudience: async () => ({
      recipientIds: options.recipients ?? ["member-1", "member-2"],
    }),
    publishUserEvent: async (userId, event, payload) => {
      statements.push(`PUBLISH:${event}`);
      published.push({ userId, event, payload });
    },
  };
  return {
    dependencies,
    statements,
    published,
    getSendCount: () => sendCount,
    getReleaseCount: () => releaseCount,
  };
}

test("announcement validation rejects invalid message and idempotency keys before connecting", async () => {
  let connected = false;
  const dependencies = createDeliveryDependencies().dependencies;
  const originalConnect = dependencies.connect;
  dependencies.connect = async () => {
    connected = true;
    return originalConnect();
  };

  for (const input of [
    { ...validInput, message: "  " },
    { ...validInput, message: "x".repeat(1001) },
    { ...validInput, idempotencyKey: "invalid" },
    { ...validInput, type: "unknown" as SendAnnouncementInput["type"] },
  ]) {
    await assert.rejects(sendAnnouncement(input, dependencies), {
      name: "AnnouncementDeliveryError",
      code: "INVALID_REQUEST",
    });
  }
  assert.equal(connected, false);
});

test("announcement delivery persists quota, recipients and idempotency before private publication", async () => {
  const fake = createDeliveryDependencies();

  const receipt = await sendAnnouncement(validInput, fake.dependencies, now);

  assert.deepEqual(receipt, {
    id: "announcement-1",
    recipientCount: 2,
    sentToday: 1,
    dailyLimit: 2,
    remainingToday: 1,
  });
  assert.equal(fake.published.length, 2);
  assert.ok(fake.published.every((item) => item.event === "announcement:created"));
  assert.ok(fake.statements.indexOf("COMMIT") < fake.statements.indexOf("PUBLISH:announcement:created"));
  assert.equal(fake.getReleaseCount(), 1);
});

test("an empty announcement audience still consumes one daily send without publishing", async () => {
  const fake = createDeliveryDependencies({ recipients: [] });

  const receipt = await sendAnnouncement(validInput, fake.dependencies, now);

  assert.equal(receipt.recipientCount, 0);
  assert.equal(receipt.sentToday, 1);
  assert.equal(fake.getSendCount(), 1);
  assert.equal(fake.published.length, 0);
  assert.ok(fake.statements.some((statement) => statement.includes("DELETE FROM announcements")));
});

test("an unexpired matching idempotency key replays the original receipt without new work", async () => {
  const receipt = {
    id: "original-announcement",
    recipientCount: 1,
    sentToday: 2,
    dailyLimit: 2,
    remainingToday: 0,
  };
  const fake = createDeliveryDependencies({
    existingIdempotency: {
      fingerprint: fingerprintFor(validInput),
      response: receipt,
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });

  assert.deepEqual(await sendAnnouncement(validInput, fake.dependencies, now), receipt);
  assert.equal(fake.statements.some((statement) => statement.includes("INSERT INTO announcements")), false);
  assert.equal(fake.statements.some((statement) => statement.includes("UPDATE announcement_daily_usage")), false);
});

test("a reused idempotency key with a different payload is rejected", async () => {
  const fake = createDeliveryDependencies({
    existingIdempotency: {
      fingerprint: fingerprintFor(validInput),
      response: {},
      expiresAt: new Date(now.getTime() + 60_000),
    },
  });

  await assert.rejects(
    sendAnnouncement({ ...validInput, message: "رسالة مختلفة" }, fake.dependencies, now),
    (error: unknown) =>
      error instanceof AnnouncementDeliveryError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("a request using an idempotency key currently locked by another send is rejected", async () => {
  const fake = createDeliveryDependencies({ lockAcquired: false });

  await assert.rejects(
    sendAnnouncement(validInput, fake.dependencies, now),
    (error: unknown) =>
      error instanceof AnnouncementDeliveryError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(fake.statements.at(-1), "ROLLBACK");
  assert.equal(fake.getSendCount(), 0);
});

test("an expired idempotency key may be used for a new announcement", async () => {
  const fake = createDeliveryDependencies({
    existingIdempotency: {
      fingerprint: "different-expired-payload",
      response: {},
      expiresAt: new Date(now.getTime() - 1),
    },
  });

  const result = await sendAnnouncement(validInput, fake.dependencies, now);

  assert.equal(result.id, "announcement-1");
  assert.ok(fake.statements.some((statement) => statement.includes("DELETE FROM announcement_idempotency")));
  assert.equal(fake.getSendCount(), 1);
});

test("quota overflow and persistence failures roll back the entire announcement", async () => {
  const noAllowance = createDeliveryDependencies({ dailyLimit: 0 });
  await assert.rejects(
    sendAnnouncement(validInput, noAllowance.dependencies, now),
    (error: unknown) =>
      error instanceof AnnouncementDeliveryError && error.code === "DAILY_LIMIT_EXCEEDED",
  );
  assert.equal(noAllowance.statements.at(-1), "ROLLBACK");
  assert.equal(noAllowance.statements.some((statement) => statement.includes("UPDATE announcement_daily_usage")), false);

  const overLimit = createDeliveryDependencies({ dailyLimit: 1, usageCount: 1 });
  await assert.rejects(
    sendAnnouncement(validInput, overLimit.dependencies, now),
    (error: unknown) =>
      error instanceof AnnouncementDeliveryError && error.code === "DAILY_LIMIT_EXCEEDED",
  );
  assert.equal(overLimit.statements.at(-1), "ROLLBACK");

  const failedInsert = createDeliveryDependencies({ failOn: "INSERT INTO announcement_recipients" });
  await assert.rejects(sendAnnouncement(validInput, failedInsert.dependencies, now), /simulated database failure/);
  assert.equal(failedInsert.statements.at(-1), "ROLLBACK");
});

test("daily usage date follows the Riyadh calendar boundary", () => {
  assert.equal(getRiyadhUsageDate(new Date("2026-10-31T20:59:59.999Z")), "2026-10-31");
  assert.equal(getRiyadhUsageDate(new Date("2026-10-31T21:00:00.000Z")), "2026-11-01");
});
