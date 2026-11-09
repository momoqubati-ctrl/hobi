import assert from "node:assert/strict";
import test from "node:test";
import {
  getMessages,
  markConversationRead,
  resolveUserIdentity,
} from "../server/services/privateMessageService";

test("legacy private-message identifiers with multiple account matches are rejected", async () => {
  const database = {
    query: async () => ({
      rows: [
        { id: "account-a", uid: "legacy-a" },
        { id: "account-b", uid: "legacy-b" },
      ],
    }),
  };

  await assert.rejects(
    resolveUserIdentity("duplicate-legacy-id", database as never),
    { name: "PrivateMessageIdentityError" },
  );
});

test("private-message identifiers matching one account ID and another account alias are rejected", async () => {
  const database = {
    query: async (text: string) => {
      if (text.includes("OR uid::text = $1")) {
        return {
          rows: [
            { id: "account-a", uid: "uid-a" },
            { id: "account-b", uid: "account-a" },
          ],
        };
      }
      if (text.includes("WHERE id::text = $1")) {
        return { rows: [{ id: "account-a", uid: "uid-a" }] };
      }
      return {
        rows: [
          { id: "account-a", uid: "uid-a" },
          { id: "account-b", uid: "account-a" },
        ],
      };
    },
  };

  await assert.rejects(
    resolveUserIdentity("account-a", database as never),
    { name: "PrivateMessageIdentityError" },
  );
});

test("a nonparticipant cannot read messages or mark the conversation read", async () => {
  const queries: string[] = [];
  const database = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes("FROM users")) {
        return { rows: [{ id: "observer-id", uid: "observer-uid" }] };
      }
      if (text.includes("FROM private_messages")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const messages = await getMessages(
    "account-a:account-b",
    "observer-id",
    50,
    undefined,
    database as never,
  );
  assert.deepEqual(messages, []);
  assert.equal(queries.some((query) => query.startsWith("UPDATE private_messages")), false);

  await markConversationRead(
    "account-a:account-b",
    "observer-id",
    database as never,
  );

  const messageQuery = queries.find((query) => query.includes("FROM private_messages"));
  assert.match(messageQuery ?? "", /sender_id\s*=\s*\$2\s+OR\s+receiver_id\s*=\s*\$2/i);
  const readUpdate = queries.find((query) => query.startsWith("UPDATE private_messages"));
  assert.match(readUpdate ?? "", /receiver_id\s*=\s*\$2/i);
  assert.match(readUpdate ?? "", /conversation_id\s*=\s*\$1/i);
});

test("canonical conversation IDs resolve to the authenticated users' legacy storage keys", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes("FROM users") && text.includes("WHERE id::text = $1")) {
        const users: Record<string, { id: string; uid: string }> = {
          "account-a": { id: "account-a", uid: "legacy-a" },
          "account-b": { id: "account-b", uid: "legacy-b" },
        };
        const user = users[String(values[0])];
        return { rows: user ? [user] : [] };
      }
      if (text.includes("FROM private_messages") && !text.startsWith("UPDATE")) {
        return {
          rows: [{
            id: "message-1",
            conversation_id: "legacy-a:legacy-b",
            sender_id: "legacy-a",
            receiver_id: "legacy-b",
            body: "private text",
            read_at: null,
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          }],
        };
      }
      return { rows: [] };
    },
  };

  const messages = await getMessages(
    "account-a:account-b",
    "account-a",
    50,
    undefined,
    database as never,
  );
  const messageQuery = queries.find(({ text }) => text.includes("FROM private_messages"));

  assert.equal(messageQuery?.values[0], "legacy-a:legacy-b");
  assert.equal(messageQuery?.values[1], "legacy-a");
  assert.equal(messages[0]?.conversationId, "account-a:account-b");
});
