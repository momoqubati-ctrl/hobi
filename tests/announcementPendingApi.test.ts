import assert from "node:assert/strict";
import {
  getResponseStatus,
  mockEvent,
} from "h3";
import test from "node:test";
import { createAnnouncementPendingHandler } from "../server/routes/api/announcements/index.get";
import { createAnnouncementDismissHandler } from "../server/routes/api/announcements/[id].delete";
import {
  dismissAnnouncement,
  listPendingAnnouncements,
  type AnnouncementPendingDependencies,
  type PendingAnnouncement,
} from "../server/services/announcementDelivery";
import { issueToken } from "../server/services/authService";

const userToken = issueToken({ id: "member-7", username: "member-seven", role: "member" });
const guestToken = issueToken({ id: "guest-1", username: "guest", role: "guest" });

const makeEvent = (path: string, token?: string) => {
  const event = mockEvent(path, {
    method: path.includes("?") ? "GET" : path.endsWith("announcements") ? "GET" : "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!path.endsWith("announcements") && !path.includes("?")) {
    event.context.params = { id: path.split("/").pop() };
  }
  return event;
};

const sampleAnnouncement: PendingAnnouncement = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "all",
  message: "تنبيه",
  senderName: "مرسل",
  senderAvatarUrl: null,
  createdAt: "2026-10-31T12:00:00.000Z",
};

test("pending announcement listing scopes to the signed-in account and paginates", async () => {
  let queryText = "";
  let queryValues: unknown[] = [];
  const rows = [
    {
      id: sampleAnnouncement.id,
      type: "all",
      message: "تنبيه",
      sender_name: "مرسل",
      sender_avatar_url: null,
      created_at: new Date(sampleAnnouncement.createdAt),
    },
    {
      ...{
        id: "00000000-0000-4000-8000-000000000002",
        type: "room",
        message: "غرفة",
        sender_name: "مرسل ٢",
        sender_avatar_url: "avatar.png",
        created_at: new Date("2026-10-31T12:01:00.000Z"),
      },
    },
  ];
  const database = {
    query: async (text: string, values: unknown[]) => {
      queryText = text;
      queryValues = values;
      return { rows };
    },
  } as never;

  const result = await listPendingAnnouncements("member-7", null, 1, database);

  assert.match(queryText, /ar\.recipient_user_id = \$1/);
  assert.match(queryText, /a\.created_at, a\.id/);
  assert.equal(queryValues[0], "member-7");
  assert.equal(queryValues[3], 2);
  assert.deepEqual(result.items, [sampleAnnouncement]);
  assert.ok(result.nextCursor);
});

test("pending announcement listing rejects invalid cursors and limits before querying", async () => {
  let queries = 0;
  const database = {
    query: async () => {
      queries += 1;
      return { rows: [] };
    },
  } as never;

  await assert.rejects(listPendingAnnouncements("member-7", "bad-cursor", 20, database), {
    code: "INVALID_REQUEST",
  });
  await assert.rejects(listPendingAnnouncements("member-7", null, 0, database), {
    code: "INVALID_REQUEST",
  });
  assert.equal(queries, 0);
});

function createDismissDependencies(options: {
  hasAnnouncement?: boolean;
  ownsRecipient?: boolean;
  hasOtherRecipients?: boolean;
} = {}) {
  const statements: string[] = [];
  const published: Array<{ userId: string; event: string; payload: unknown }> = [];
  let releaseCount = 0;
  const client = {
    async query(text: string) {
      statements.push(text);
      if (text.includes("SELECT id FROM announcements")) {
        return { rows: options.hasAnnouncement === false ? [] : [{ id: sampleAnnouncement.id }] };
      }
      if (text.includes("DELETE FROM announcement_recipients")) {
        return { rows: options.ownsRecipient === false ? [] : [{ announcement_id: sampleAnnouncement.id }] };
      }
      if (text.includes("DELETE FROM announcements")) {
        return { rows: options.hasOtherRecipients ? [] : [{ id: sampleAnnouncement.id }] };
      }
      return { rows: [] };
    },
    release() {
      releaseCount += 1;
    },
  };
  const dependencies: AnnouncementPendingDependencies = {
    connect: async () => client as never,
    publishUserEvent: async (userId, event, payload) => {
      statements.push(`PUBLISH:${event}`);
      published.push({ userId, event, payload });
    },
  };
  return { dependencies, statements, published, getReleaseCount: () => releaseCount };
}

test("dismissing the last recipient removes announcement content and broadcasts after commit", async () => {
  const fake = createDismissDependencies();

  await dismissAnnouncement("member-7", sampleAnnouncement.id, fake.dependencies);

  assert.ok(fake.statements.some((statement) => statement.includes("DELETE FROM announcements")));
  assert.ok(fake.statements.indexOf("COMMIT") < fake.statements.indexOf("PUBLISH:announcement:dismissed"));
  assert.deepEqual(fake.published, [{
    userId: "member-7",
    event: "announcement:dismissed",
    payload: { id: sampleAnnouncement.id },
  }]);
  assert.equal(fake.getReleaseCount(), 1);
});

test("dismissing another account's announcement is idempotent and reveals no existence", async () => {
  const fake = createDismissDependencies({ ownsRecipient: false });

  await dismissAnnouncement("member-7", sampleAnnouncement.id, fake.dependencies);

  assert.equal(fake.statements.some((statement) => statement.includes("DELETE FROM announcements")), false);
  assert.equal(fake.published.length, 0);
  assert.equal(fake.statements.at(-1), "COMMIT");
});

test("pending GET API authenticates users and returns only the service response", async () => {
  const handler = createAnnouncementPendingHandler(async (userId, cursor, limit) => {
    assert.equal(userId, "member-7");
    assert.equal(cursor, "opaque-cursor");
    assert.equal(limit, 5);
    return { items: [sampleAnnouncement], nextCursor: null };
  });
  const invalid = makeEvent("/api/announcements");
  await handler(invalid);
  assert.equal(getResponseStatus(invalid), 401);

  const guest = makeEvent("/api/announcements", guestToken);
  await handler(guest);
  assert.equal(getResponseStatus(guest), 403);

  const valid = makeEvent("/api/announcements?cursor=opaque-cursor&limit=5", userToken);
  assert.deepEqual(await handler(valid), { success: true, items: [sampleAnnouncement], nextCursor: null });
});

test("pending DELETE API derives the recipient from the session", async () => {
  let received: { userId: string; announcementId: string } | undefined;
  const handler = createAnnouncementDismissHandler(async (userId, announcementId) => {
    received = { userId, announcementId };
  });
  const event = makeEvent(`/api/announcements/${sampleAnnouncement.id}`, userToken);

  assert.deepEqual(await handler(event), { success: true });
  assert.deepEqual(received, { userId: "member-7", announcementId: sampleAnnouncement.id });
});
