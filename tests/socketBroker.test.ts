import assert from "node:assert/strict";
import test from "node:test";
import { hasLocalUserRoomRecipients } from "../server/socket/SocketBroker";

test("user event routing detects whether the local socket server owns the target room", () => {
  const rooms = new Map<string, ReadonlySet<string>>([
    ["user:member-1", new Set(["socket-1"])],
    ["user:member-2", new Set()],
  ]);

  assert.equal(hasLocalUserRoomRecipients(rooms, "member-1"), true);
  assert.equal(hasLocalUserRoomRecipients(rooms, "member-2"), false);
  assert.equal(hasLocalUserRoomRecipients(rooms, "member-3"), false);
});
