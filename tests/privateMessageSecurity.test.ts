import assert from "node:assert/strict";
import { getResponseStatus, mockEvent } from "h3";
import test from "node:test";
import { createPrivateMessageSendHandler } from "../server/routes/api/pm/send.post";
import { getUserAuthContext } from "../server/services/adminAccess";
import {
  getMessages,
  resolveUserIdentity,
} from "../server/services/privateMessageService";

type AuthContext = ReturnType<typeof getUserAuthContext>;

const message = {
  id: "message-1",
  conversationId: "member-a:member-b",
  senderId: "member-a",
  senderUserId: "member-a",
  receiverId: "member-b",
  receiverUserId: "member-b",
  body: "private text",
  readAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function createEvent(body: unknown = { receiverId: "member-b", text: "private text" }) {
  return mockEvent("/api/pm/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDependencies(options: {
  authenticated?: boolean;
  senderId?: string;
} = {}) {
  const deliveries: Array<{ userId: string; event: string; payload: unknown }> = [];
  let sendCount = 0;
  const dependencies = {
    authenticate: (): AuthContext => options.authenticated === false
      ? { ok: false as const, statusCode: 401, message: "غير مصرح" }
      : { ok: true as const, userId: options.senderId ?? "member-a", role: "member" },
    isMuted: async () => false,
    hasAccess: async () => true,
    sendMessage: async (senderId: string, receiverId: string, text: string) => {
      sendCount += 1;
      assert.equal(senderId, options.senderId ?? "member-a");
      assert.equal(receiverId, "member-b");
      assert.equal(text, "private text");
      return message;
    },
    createNotification: async () => undefined,
    publishToUser: async (userId: string, event: string, payload: unknown) => {
      deliveries.push({ userId, event, payload });
    },
  };
  return { dependencies, deliveries, getSendCount: () => sendCount };
}

test("REST PM fallback delivers only to sender and recipient rooms", async () => {
  const fake = createDependencies();
  const handler = createPrivateMessageSendHandler(fake.dependencies);

  const response = await handler(createEvent()) as { success: boolean; message: { text: string } };

  assert.equal(response.success, true);
  assert.equal(response.message.text, "private text");
  assert.deepEqual(fake.deliveries.map(({ userId, event }) => ({ userId, event })), [
    { userId: "member-b", event: "pm:message" },
    { userId: "member-a", event: "pm:message" },
  ]);
  assert.equal(fake.deliveries.length, 2);
});

test("REST PM fallback does not persist or publish without an authenticated sender", async () => {
  const fake = createDependencies({ authenticated: false });
  const handler = createPrivateMessageSendHandler(fake.dependencies);
  const event = createEvent();

  await handler(event);

  assert.equal(getResponseStatus(event), 401);
  assert.equal(fake.getSendCount(), 0);
  assert.equal(fake.deliveries.length, 0);
});

test("REST PM fallback ignores a body-supplied sender identity", async () => {
  const fake = createDependencies();
  const handler = createPrivateMessageSendHandler(fake.dependencies);

  await handler(createEvent({
    senderId: "victim",
    receiverId: "member-b",
    text: "private text",
  }));

  assert.equal(fake.getSendCount(), 1);
  assert.deepEqual(fake.deliveries.map((delivery) => delivery.userId), ["member-b", "member-a"]);
});

test("legacy PM identifiers with multiple account matches are rejected", async () => {
  const database = {
    query: async (text: string) => ({
      rows: text.includes("WHERE id::text = $1")
        ? []
        : [
            { id: "account-a", uid: "legacy-a" },
            { id: "account-b", uid: "legacy-b" },
          ],
    }),
  };

  await assert.rejects(
    resolveUserIdentity("duplicate-idreg", database as never),
    { name: "PrivateMessageIdentityError" },
  );
});

test("a nonparticipant cannot read another conversation or mark it read", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const privateRows = [{
    id: "message-1",
    conversation_id: "member-a:member-b",
    sender_id: "member-a",
    receiver_id: "member-b",
    body: "secret",
    read_at: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
  }];
  const database = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes("FROM users")) {
        return { rows: [{ id: "observer-id", uid: "observer-uid" }] };
      }
      if (text.includes("FROM private_messages")) {
        const hasMembershipFilter = /sender_id\s*=\s*\$2\s+OR\s+receiver_id\s*=\s*\$2/i.test(text);
        return { rows: hasMembershipFilter ? [] : privateRows };
      }
      return { rows: [] };
    },
  };

  const result = await getMessages(
    "member-a:member-b",
    "observer-id",
    50,
    undefined,
    database as never,
  );

  assert.deepEqual(result, []);
  assert.equal(queries.some(({ text }) => text.startsWith("UPDATE private_messages")), false);
});
