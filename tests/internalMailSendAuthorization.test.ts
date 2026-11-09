import assert from "node:assert/strict";
import { getResponseStatus, mockEvent } from "h3";
import test from "node:test";
import { createInternalMailSendHandler } from "../server/routes/api/mail/send.post";

test("REST internal mail ignores a body-supplied sender ID", async () => {
  const sentAs: string[] = [];
  const event = mockEvent("/api/mail/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      senderId: "victim-account",
      recipientId: "recipient-account",
      text: "private mail",
    }),
  });
  const handler = createInternalMailSendHandler({
    authenticate: () => ({
      ok: true,
      userId: "session-account",
      username: "member",
      role: "member",
    }),
    sendMail: async (senderId, recipientId, text) => {
      sentAs.push(senderId);
      return {
        id: "mail-1",
        senderId,
        recipientId,
        subject: text,
        body: text,
      };
    },
    createNotification: async () => undefined,
    publishParticipants: async () => undefined,
  });

  const response = await handler(event) as { success: boolean };

  assert.equal(response.success, true);
  assert.deepEqual(sentAs, ["session-account"]);
  assert.equal(getResponseStatus(event), 200);
});
