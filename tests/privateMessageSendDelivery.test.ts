import assert from "node:assert/strict";
import { getResponseStatus, mockEvent } from "h3";
import test from "node:test";
import { createPrivateMessageSendHandler } from "../server/routes/api/pm/send.post";

test("REST PM delivery targets canonical participant rooms and reports publish failure", async () => {
  const deliveries: string[] = [];
  let storedText = "";
  const handler = createPrivateMessageSendHandler({
    authenticate: () => ({
      ok: true,
      userId: "account-a",
      username: "member-a",
      role: "member",
    }),
    isMuted: async () => false,
    hasAccess: async () => true,
    processText: async (text) => `filtered:${text}`,
    sendMessage: async (_senderId, _receiverId, text) => {
      storedText = text;
      return {
      id: "message-1",
      conversationId: "legacy-a:legacy-b",
      senderId: "legacy-a",
      senderUserId: "account-a",
      receiverId: "legacy-b",
      receiverUserId: "account-b",
      body: text,
      readAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      };
    },
    createNotification: async () => undefined,
    publishToUser: async (userId) => {
      deliveries.push(userId);
      if (userId === "account-b") throw new Error("offline");
    },
  });
  const event = mockEvent("/api/pm/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiverId: "legacy-b", text: "private text" }),
  });

  const response = await handler(event) as {
    success: boolean;
    realtimeDelivery: string;
    message: { conversationId: string; senderId: string; receiverId: string };
  };

  assert.equal(response.success, true);
  assert.equal(response.realtimeDelivery, "failed");
  assert.equal(response.message.conversationId, "account-a:account-b");
  assert.equal(response.message.senderId, "account-a");
  assert.equal(response.message.receiverId, "account-b");
  assert.equal(storedText, "filtered:private text");
  assert.deepEqual(deliveries, ["account-b", "account-a"]);
});

test("REST PM does not persist or deliver when text processing fails", async () => {
  let sendAttempted = false;
  const handler = createPrivateMessageSendHandler({
    authenticate: () => ({
      ok: true,
      userId: "account-a",
      username: "member-a",
      role: "member",
    }),
    isMuted: async () => false,
    hasAccess: async () => true,
    processText: async () => {
      throw new Error("filter unavailable");
    },
    sendMessage: async () => {
      sendAttempted = true;
      throw new Error("must not send");
    },
    createNotification: async () => undefined,
    publishToUser: async () => undefined,
  });
  const event = mockEvent("/api/pm/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiverId: "account-b", text: "private text" }),
  });

  const response = await handler(event) as { success: boolean };

  assert.equal(response.success, false);
  assert.equal(getResponseStatus(event), 500);
  assert.equal(sendAttempted, false);
});
