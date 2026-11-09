import assert from "node:assert/strict";
import test from "node:test";
import { publishMailToParticipants } from "../server/socket/mailDelivery";

test("internal mail is delivered only to sender and recipient social rooms", async () => {
  const deliveries: Array<{ roomId: string; event: string; payload: unknown }> = [];
  const mail = { senderId: "account-a", recipientId: "account-b" };
  const payload = { ...mail, body: "private mail" };

  await publishMailToParticipants(mail, payload, async (roomId, event, eventPayload) => {
    deliveries.push({ roomId, event, payload: eventPayload });
  });

  assert.deepEqual(deliveries, [
    { roomId: "social:account-a", event: "internal_mail", payload },
    { roomId: "social:account-b", event: "internal_mail", payload },
  ]);
});

test("internal mail sent to the same account is delivered to that account only once", async () => {
  const rooms: string[] = [];

  await publishMailToParticipants(
    { senderId: "account-a", recipientId: "account-a" },
    { body: "private mail" },
    async (roomId) => {
      rooms.push(roomId);
    },
  );

  assert.deepEqual(rooms, ["social:account-a"]);
});
