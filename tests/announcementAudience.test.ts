import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnouncementAudienceError,
  resolveAnnouncementAudience,
  type AnnouncementAudienceDependencies,
  type AnnouncementAudienceUser,
  type RankedAnnouncementRoleAssignment,
} from "../server/services/announcementAudience";

const now = new Date("2026-03-01T12:00:00.000Z");

function createDependencies(
  overrides: Partial<AnnouncementAudienceDependencies> = {},
): AnnouncementAudienceDependencies {
  return {
    getOnlineUsers: async () => [],
    getRoomMembers: async () => [],
    resolveRoomId: async () => "canonical-room-id",
    getRankedAssignments: async () => [],
    ...overrides,
  };
}

function user(
  id: string,
  role = "member",
  roomId = "",
): AnnouncementAudienceUser {
  return { id, role, roomId };
}

test("all announcements deduplicate connected member accounts and exclude guests", async () => {
  const dependencies = createDependencies({
    getOnlineUsers: async () => [
      user("member-1"),
      user("member-1"),
      user("member-2"),
      user("guest-1", "guest"),
      user("0"),
    ],
  });

  const result = await resolveAnnouncementAudience(
    { type: "all" },
    dependencies,
  );

  assert.deepEqual(result.recipientIds, ["member-1", "member-2"]);
});

test("ranked announcements include only online users with an active non-default assignment", async () => {
  const activeRole: RankedAnnouncementRoleAssignment = {
    userId: "ranked-1",
    isActive: true,
    isDefault: false,
    startsAt: new Date("2026-02-01T00:00:00.000Z"),
    expiresAt: null,
  };
  const dependencies = createDependencies({
    getOnlineUsers: async () => [
      user("ranked-1"),
      user("ranked-1"),
      user("default-only"),
      user("expired-rank"),
      user("guest-ranked", "guest"),
    ],
    getRankedAssignments: async () => [
      activeRole,
      {
        ...activeRole,
        userId: "default-only",
        isDefault: true,
      },
      {
        ...activeRole,
        userId: "expired-rank",
        expiresAt: new Date("2026-03-01T12:00:00.000Z"),
      },
      {
        ...activeRole,
        userId: "future-rank",
        startsAt: new Date("2026-03-01T12:00:00.001Z"),
      },
    ],
  });

  const result = await resolveAnnouncementAudience(
    { type: "ranked" },
    dependencies,
    now,
  );

  assert.deepEqual(result.recipientIds, ["ranked-1"]);
});

test("room announcements resolve canonical room membership and include the sender when present", async () => {
  const requestedRooms: string[] = [];
  const dependencies = createDependencies({
    resolveRoomId: async (roomId) => {
      requestedRooms.push(roomId);
      return "canonical-room-id";
    },
    getRoomMembers: async (roomId) => {
      assert.equal(roomId, "canonical-room-id");
      return [
        user("room-member", "member", "canonical-room-id"),
        user("room-member", "member", "canonical-room-id"),
        user("sender", "member", "canonical-room-id"),
        user("other-room-user", "member", "another-room"),
        user("room-guest", "guest"),
      ];
    },
  });

  const result = await resolveAnnouncementAudience(
    { type: "room", roomId: "room:my-room" },
    dependencies,
  );

  assert.deepEqual(requestedRooms, ["room:my-room"]);
  assert.equal(result.roomId, "canonical-room-id");
  assert.deepEqual(result.recipientIds, ["room-member", "sender"]);
});

test("an empty room audience stays empty and unknown rooms are rejected", async () => {
  const emptyResult = await resolveAnnouncementAudience(
    { type: "room", roomId: "my-room" },
    createDependencies(),
  );
  assert.deepEqual(emptyResult.recipientIds, []);

  await assert.rejects(
    resolveAnnouncementAudience(
      { type: "room", roomId: "missing-room" },
      createDependencies({ resolveRoomId: async () => null }),
    ),
    (error: unknown) =>
      error instanceof AnnouncementAudienceError && error.code === "ROOM_NOT_FOUND",
  );
});
