import test from "node:test";
import assert from "node:assert/strict";
import {
  ParticipantInfo,
  ParticipantPermission,
  Room,
  TrackInfo,
  TrackType,
  type RoomServiceClient,
} from "livekit-server-sdk";
import {
  createConfiguredLiveKitRoomServiceClient,
  createLiveKitRoomServiceClient,
  disconnectConfiguredLiveKitParticipant,
  disconnectLiveKitParticipant,
  ensureLiveKitRoomExists,
  reconcileLiveKitPublishPermissions,
  syncLiveKitPublishPermission,
} from "../server/services/livekitVoicePermissions";

const makeParticipant = () =>
  new ParticipantInfo({
    identity: "user-1",
    permission: new ParticipantPermission({
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canPublishSources: [],
      hidden: false,
      recorder: false,
      canUpdateMetadata: true,
      agent: false,
      canSubscribeMetrics: false,
    }),
    tracks: [
      new TrackInfo({ sid: "audio-track", type: TrackType.AUDIO }),
      new TrackInfo({ sid: "video-track", type: TrackType.VIDEO }),
    ],
  });

test("revoking a voice publisher mutes audio and disables publish permissions", async () => {
  const participant = makeParticipant();
  const mutedTracks: string[] = [];
  let updatedPermission: ParticipantPermission | undefined;
  const client = {
    listParticipants: async () => [participant],
    updateParticipant: async (_roomId, _identity, options) => {
      updatedPermission = options.permission as ParticipantPermission;
      return participant;
    },
    mutePublishedTrack: async (_roomId, _identity, trackSid, muted) => {
      if (muted) mutedTracks.push(trackSid);
      return new TrackInfo();
    },
    removeParticipant: async () => {},
  } satisfies Pick<RoomServiceClient, "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant">;

  await syncLiveKitPublishPermission(client, "room-1", "user-1", false);

  assert.deepStrictEqual(mutedTracks, ["audio-track"]);
  assert.strictEqual(updatedPermission?.canPublish, false);
  assert.strictEqual(updatedPermission?.canPublishData, false);
  assert.strictEqual(updatedPermission?.canSubscribe, true);
  assert.strictEqual(updatedPermission?.canUpdateMetadata, true);
});

test("failed publish revocation disconnects the participant as a fail-closed fallback", async () => {
  const participant = makeParticipant();
  let removed = false;
  const client = {
    listParticipants: async () => [participant],
    updateParticipant: async () => {
      throw new Error("permission update failed");
    },
    mutePublishedTrack: async () => new TrackInfo(),
    removeParticipant: async (_roomId, _identity, options) => {
      removed = typeof options?.revokeTokenTs === "bigint";
    },
  } satisfies Pick<RoomServiceClient, "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant">;

  await syncLiveKitPublishPermission(client, "room-1", "user-1", false);

  assert.strictEqual(removed, true);
});

test("failed audio muting disconnects the participant as a fail-closed fallback", async () => {
  const participant = makeParticipant();
  let removed = false;
  const client = {
    listParticipants: async () => [participant],
    updateParticipant: async () => participant,
    mutePublishedTrack: async () => {
      throw new Error("track mute failed");
    },
    removeParticipant: async () => {
      removed = true;
    },
  } satisfies Pick<RoomServiceClient, "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant">;

  await syncLiveKitPublishPermission(client, "room-1", "user-1", false);

  assert.strictEqual(removed, true);
});

test("granting voice publishing does not attempt remote track unmuting", async () => {
  const participant = makeParticipant();
  let updatedPermission: ParticipantPermission | undefined;
  let attemptedUnmute = false;
  const client = {
    listParticipants: async () => [participant],
    updateParticipant: async (_roomId, _identity, options) => {
      updatedPermission = options.permission as ParticipantPermission;
      return participant;
    },
    mutePublishedTrack: async (_roomId, _identity, _trackSid, muted) => {
      attemptedUnmute ||= !muted;
      return new TrackInfo();
    },
    removeParticipant: async () => {},
  } satisfies Pick<RoomServiceClient, "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant">;

  await syncLiveKitPublishPermission(client, "room-1", "user-1", true);

  assert.strictEqual(updatedPermission?.canPublish, true);
  assert.strictEqual(updatedPermission?.canPublishData, false);
  assert.strictEqual(attemptedUnmute, false);
});

test("permission synchronization ignores identities that are not connected", async () => {
  let updated = false;
  const client = {
    listParticipants: async () => [],
    updateParticipant: async () => {
      updated = true;
      return new ParticipantInfo();
    },
    mutePublishedTrack: async () => new TrackInfo(),
    removeParticipant: async () => {},
  } satisfies Pick<RoomServiceClient, "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant">;

  await syncLiveKitPublishPermission(client, "room-1", "user-1", false);

  assert.strictEqual(updated, false);
});

test("leaving a room removes the participant from LiveKit and revokes their token", async () => {
  let removedParticipant: { roomId: string; identity: string; revokeTokenTs?: bigint } | undefined;
  const client = {
    removeParticipant: async (roomId, identity, options) => {
      removedParticipant = { roomId, identity, revokeTokenTs: options?.revokeTokenTs };
    },
  } satisfies Pick<RoomServiceClient, "removeParticipant">;

  await disconnectLiveKitParticipant(client, "room-1", "user-1");

  assert.equal(removedParticipant?.roomId, "room-1");
  assert.equal(removedParticipant?.identity, "user-1");
  assert.ok(removedParticipant?.revokeTokenTs);
  assert.ok(removedParticipant.revokeTokenTs >= BigInt(Math.floor(Date.now() / 1000)));
});

test("leaving after a participant has already disconnected is idempotent", async () => {
  const client = {
    removeParticipant: async () => {
      throw Object.assign(new Error("participant not found"), { code: "not_found" });
    },
  } satisfies Pick<RoomServiceClient, "removeParticipant">;

  await assert.doesNotReject(() =>
    disconnectLiveKitParticipant(client, "room-1", "user-1"),
  );
});

test("configured participant cleanup is inactive when WebRTC is selected", async () => {
  await assert.doesNotReject(() =>
    disconnectConfiguredLiveKitParticipant("room-1", "user-1", async () => null),
  );
});

test("reconciliation revokes stale publishers and grants only active eligible seats", async () => {
  const stalePublisher = makeParticipant();
  const activeListener = new ParticipantInfo({
    identity: "user-2",
    permission: new ParticipantPermission({
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canPublishSources: [],
    }),
    tracks: [],
  });
  const updates = new Map<string, ParticipantPermission>();
  const client = {
    listRooms: async () => [new Room({ name: "room-1" })],
    listParticipants: async () => [stalePublisher, activeListener],
    updateParticipant: async (_roomId, identity, options) => {
      updates.set(identity, options.permission as ParticipantPermission);
      return identity === "user-1" ? stalePublisher : activeListener;
    },
    mutePublishedTrack: async () => new TrackInfo(),
    removeParticipant: async () => {},
  } satisfies Pick<RoomServiceClient, "listRooms" | "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant">;

  await reconcileLiveKitPublishPermissions(client, new Set(["room-1\u0000user-2"]));

  assert.strictEqual(updates.get("user-1")?.canPublish, false);
  assert.strictEqual(updates.get("user-1")?.canPublishData, false);
  assert.strictEqual(updates.get("user-2")?.canPublish, true);
  assert.deepStrictEqual(updates.get("user-2")?.canPublishSources, [2]);
});

test("Room Service client configuration rejects insecure production URLs and placeholders", () => {
  assert.strictEqual(createLiveKitRoomServiceClient({}), null);
  assert.throws(
    () =>
      createLiveKitRoomServiceClient({
        LIVEKIT_URL: "ws://localhost:7880",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "a".repeat(32),
        NODE_ENV: "production",
      }),
    /LiveKit URL is invalid/,
  );
  assert.throws(
    () =>
      createLiveKitRoomServiceClient({
        LIVEKIT_URL: "wss://livekit.example.com/path",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "a".repeat(32),
      }),
    /LiveKit URL is invalid/,
  );
});

test("configured Room Service client uses persisted provider credentials", async () => {
  let configLoaded = false;

  const client = await createConfiguredLiveKitRoomServiceClient(async () => {
    configLoaded = true;
    return {
      url: "wss://voice.example.com",
      apiKey: "livekit-api-key",
      apiSecret: "a".repeat(32),
    };
  });

  assert.equal(configLoaded, true);
  assert.ok(client);
});

test("configured Room Service client stays inactive when WebRTC is selected", async () => {
  const client = await createConfiguredLiveKitRoomServiceClient(async () => null);

  assert.equal(client, null);
});

test("missing LiveKit rooms are created through the Room Service API", async () => {
  const createdRooms: Array<{ name: string }> = [];
  const client = {
    listRooms: async () => [],
    createRoom: async (options) => {
      createdRooms.push(options);
      return new Room({ name: options.name });
    },
  } satisfies Pick<RoomServiceClient, "listRooms" | "createRoom">;

  await ensureLiveKitRoomExists(client, "room-1");

  assert.deepStrictEqual(createdRooms, [{ name: "room-1" }]);
});

test("existing LiveKit rooms are not recreated", async () => {
  let createAttempts = 0;
  const client = {
    listRooms: async () => [new Room({ name: "room-1" })],
    createRoom: async () => {
      createAttempts += 1;
      return new Room({ name: "room-1" });
    },
  } satisfies Pick<RoomServiceClient, "listRooms" | "createRoom">;

  await ensureLiveKitRoomExists(client, "room-1");

  assert.equal(createAttempts, 0);
});

test("concurrent LiveKit room creation treats an already-created room as success", async () => {
  const client = {
    listRooms: async () => [],
    createRoom: async () => {
      throw Object.assign(new Error("room already exists"), { code: "already_exists" });
    },
  } satisfies Pick<RoomServiceClient, "listRooms" | "createRoom">;

  await assert.doesNotReject(() => ensureLiveKitRoomExists(client, "room-1"));
});
