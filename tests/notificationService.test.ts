import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationWithDependencies } from "../server/services/notificationService";

const recipientId = "recipient-1";
const actorId = "2558a6ab-3478-4707-a2e4-6e72aa7924de";

test("creates a notification with a null actor when the actor no longer exists", async () => {
  const inserts: Array<(string | null)[]> = [];
  let actorLookupCount = 0;

  const createNotification = createNotificationWithDependencies(async (text, values = []) => {
    if (text.includes("FROM users u")) {
      actorLookupCount += 1;
      return { rows: [] };
    }

    if (text.includes("INSERT INTO notifications")) {
      inserts.push(values);
      if (values[1] !== null) {
        throw Object.assign(new Error("foreign key conflict"), {
          code: "23503",
          constraint: "notifications_actor_id_users_id_fk",
        });
      }

      return {
        rows: [{
          id: "notification-1",
          user_id: recipientId,
          actor_id: null,
          type: "follow",
          entity_type: "user",
          entity_id: actorId,
          metadata: {},
          read_at: null,
          created_at: new Date("2026-11-10T00:00:00.000Z"),
        }],
      };
    }

    if (text.includes("SELECT COUNT(*)")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  }, async () => undefined, async () => 0);

  const notification = await createNotification(
    recipientId,
    actorId,
    "follow",
    "user",
    actorId,
  );

  assert.equal(notification?.actorId, null);
  assert.deepEqual(inserts.map((values) => values[1]), [null]);
  assert.equal(actorLookupCount, 1);
});

test("retries a notification without its actor when the actor is deleted during insertion", async () => {
  const inserts: Array<(string | null)[]> = [];

  const createNotification = createNotificationWithDependencies(async (text, values = []) => {
    if (text.includes("FROM users u")) {
      return {
        rows: [{
          id: actorId,
          username: "member",
          topic: "Member",
          pic: "/member.png",
          actor_name_color: "",
        }],
      };
    }

    if (text.includes("INSERT INTO notifications")) {
      inserts.push(values);
      if (values[1] !== null) {
        throw Object.assign(new Error("foreign key conflict"), {
          code: "23503",
          constraint: "notifications_actor_id_users_id_fk",
        });
      }

      return {
        rows: [{
          id: "notification-2",
          user_id: recipientId,
          actor_id: null,
          type: "follow",
          entity_type: "user",
          entity_id: actorId,
          metadata: {},
          read_at: null,
          created_at: new Date("2026-11-10T00:00:00.000Z"),
        }],
      };
    }

    if (text.includes("SELECT COUNT(*)")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  }, async () => undefined, async () => 0);

  const notification = await createNotification(
    recipientId,
    actorId,
    "follow",
    "user",
    actorId,
  );

  assert.equal(notification?.actorId, null);
  assert.deepEqual(inserts.map((values) => values[1]), [actorId, null]);
});
