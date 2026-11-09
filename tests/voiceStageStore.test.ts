import assert from "node:assert/strict";
import test from "node:test";
import { VoiceStageStore, type RoomVoiceStage, type VoiceSeat } from "../server/services/voiceStageStore";

const createStage = (roomId: string, maxSeats = 2): RoomVoiceStage => ({
  roomId,
  maxSeats,
  isVoiceChannel: false,
  seats: Array.from({ length: maxSeats }, () => null),
});

const createSeat = (userId: string, seatIndex: number): VoiceSeat => ({
  seatIndex,
  userId,
  username: userId,
  avatar: "/pic.png",
  isMuted: false,
  isLocked: false,
  joinedAt: 1,
});

const createStore = () => new VoiceStageStore({ redisEnabled: false, nodeEnv: "test" });

test("taking a seat moves the user atomically and leaves their previous seat empty", async () => {
  const store = createStore();
  await store.ensureStage(createStage("room-a"));
  await store.ensureStage(createStage("room-b"));

  assert.equal((await store.takeSeat("room-a", createSeat("user-1", 0))).success, true);
  const moved = await store.takeSeat("room-b", createSeat("user-1", 1));

  assert.equal(moved.success, true);
  assert.equal((await store.getStage("room-a"))?.seats[0], null);
  assert.equal((await store.getStage("room-b"))?.seats[1]?.userId, "user-1");
});

test("a failed seat take does not evict the user's existing seat", async () => {
  const store = createStore();
  await store.ensureStage(createStage("room-a"));
  await store.ensureStage(createStage("room-b"));
  await store.takeSeat("room-a", createSeat("user-1", 0));
  await store.takeSeat("room-b", createSeat("user-2", 0));

  const result = await store.takeSeat("room-b", createSeat("user-1", 0));

  assert.equal(result.success, false);
  assert.equal((await store.getStage("room-a"))?.seats[0]?.userId, "user-1");
  assert.equal((await store.getStage("room-b"))?.seats[0]?.userId, "user-2");
});

test("seat locks, mute state, removal, and active-seat lookup stay consistent", async () => {
  const store = createStore();
  await store.ensureStage(createStage("room-a"));
  await store.setSeatLock("room-a", 1, true);

  const lockedTake = await store.takeSeat("room-a", createSeat("user-1", 1));
  assert.equal(lockedTake.success, false);
  await store.kickSeat("room-a", 1);
  assert.equal((await store.getStage("room-a"))?.seats[1]?.isLocked, true);

  await store.takeSeat("room-a", createSeat("user-1", 0));
  await store.toggleMute("room-a", "user-1", true);
  assert.equal((await store.getStage("room-a"))?.seats[0]?.isMuted, true);
  assert.deepEqual((await store.listActiveSeats()).map(({ seat }) => seat.userId), ["user-1"]);
  assert.equal(await store.claimExperienceTick("user-1", 12), true);
  assert.equal(await store.claimExperienceTick("user-1", 12), false);
  assert.equal(await store.claimExperienceTick("user-1", 13), true);

  const kicked = await store.kickSeat("room-a", 0);
  assert.equal(kicked?.userId, "user-1");
  assert.equal((await store.getStage("room-a"))?.seats[0], null);
  assert.deepEqual(await store.listActiveSeats(), []);
});

test("account mute state is tracked separately from a speaker's self-mute state", async () => {
  const store = createStore();
  await store.ensureStage(createStage("room-a"));
  await store.takeSeat("room-a", createSeat("user-1", 0));
  await store.toggleMute("room-a", "user-1", true);

  const globallyMuted = await store.setAccountMuted("user-1", true);
  assert.equal(globallyMuted?.seat.accountMuted, true);
  assert.equal(globallyMuted?.seat.isMuted, true);

  const unmuted = await store.setAccountMuted("user-1", false);
  assert.equal(unmuted?.seat.accountMuted, false);
  assert.equal(unmuted?.seat.isMuted, true);
});

test("only one maintenance pass can claim a shared permission-reconciliation minute", async () => {
  const store = createStore();

  assert.equal(await store.claimPermissionReconciliationTick(12), true);
  assert.equal(await store.claimPermissionReconciliationTick(12), false);
  assert.equal(await store.claimPermissionReconciliationTick(13), true);
});

test("production voice-stage storage refuses to fall back to process memory", async () => {
  const store = new VoiceStageStore({ redisEnabled: false, nodeEnv: "production" });

  await assert.rejects(() => store.getStage("room-a"), /Redis is required/);
});
