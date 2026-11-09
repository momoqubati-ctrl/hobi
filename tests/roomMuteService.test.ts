import assert from "node:assert/strict";
import test from "node:test";
import { createRoomMuteService, deriveRoomIds } from "../server/services/roomMuteService";
import { canRunProfileAdminAction } from "../src/lib/profileAdminPermissions";

const makePool = () => {
  const calls: { text: string; values?: any[] }[] = [];
  const pool: any = {
    calls,
    query: async (text: string, values?: any[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool, calls };
};

// ── deriveRoomIds (خالصة) ──
test("deriveRoomIds adds raw, stripped and room:-prefixed variants", () => {
  const combined = new Set(deriveRoomIds("room:abc", "abc"));
  assert.ok(combined.has("abc"));
  assert.ok(combined.has("room:abc"));
});

test("deriveRoomIds handles empty values safely", () => {
  assert.deepEqual(deriveRoomIds("", ""), []);
});

test("deriveRoomIds with prefixed canonical only", () => {
  const set = new Set(deriveRoomIds("room:x", ""));
  assert.ok(set.has("room:x"));
  assert.ok(set.has("x"));
});

// ── setRoomMute ──
test("setRoomMute inserts a row per room variant", async () => {
  const { pool, calls } = makePool();
  const service = createRoomMuteService(pool);
  const result = await service.setRoomMute({ roomId: "A", rawRoomId: "A", userId: "u1", mutedBy: "admin1" });
  assert.equal(result, true);
  const inserts = calls.filter((c) => /INSERT INTO room_mutes/.test(c.text));
  assert.equal(inserts.length, 2);
  const insertedRooms = inserts.map((c) => c.values?.[0]).sort();
  assert.deepEqual(insertedRooms, ["A", "room:A"]);
  // لا يُكتب في الجدول العام
  assert.ok(calls.every((c) => !/"users"/.test(c.text) || !/UPDATE/.test(c.text)));
});

test("setRoomMute skips variants already actively muted", async () => {
  const pool: any = {
    query: async (text: string, values?: any[]) => {
      if (/SELECT room_id FROM room_mutes/.test(text)) {
        return { rows: [{ room_id: "A" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const service = createRoomMuteService(pool);
  const result = await service.setRoomMute({ roomId: "A", rawRoomId: "A", userId: "u1" });
  assert.equal(result, true);
});

test("setRoomMute refuses empty identifiers", async () => {
  const service = createRoomMuteService(makePool().pool);
  assert.equal(await service.setRoomMute({ roomId: "", userId: "u1" }), false);
  assert.equal(await service.setRoomMute({ roomId: "A", userId: " " }), false);
});

// ── isRoomMutedForUser ──
test("isRoomMutedForUser true when an active row matches", async () => {
  const pool: any = {
    query: async () => ({ rows: [{ id: "r1" }], rowCount: 1 }),
  };
  const service = createRoomMuteService(pool);
  assert.equal(await service.isRoomMutedForUser(["room:A", "A"], "u1"), true);
});

test("isRoomMutedForUser false when nothing matches", async () => {
  const pool: any = {
    query: async () => ({ rows: [], rowCount: 0 }),
  };
  const service = createRoomMuteService(pool);
  assert.equal(await service.isRoomMutedForUser(["room:A", "A"], "u1"), false);
});

test("isRoomMutedForUser fails closed on DB error", async () => {
  const pool: any = {
    query: async () => { throw new Error("boom"); },
  };
  const service = createRoomMuteService(pool);
  assert.equal(await service.isRoomMutedForUser(["A"], "u1"), false);
});

// ── clearRoomMutesForUser / clearRoomMute ──
test("clearRoomMutesForUser deletes and returns count", async () => {
  const pool: any = {
    query: async () => ({ rows: [], rowCount: 3 }),
  };
  const service = createRoomMuteService(pool);
  assert.equal(await service.clearRoomMutesForUser("u1"), 3);
});

test("clearRoomMute deletes only the requested rooms", async () => {
  const { pool, calls } = makePool();
  const service = createRoomMuteService(pool);
  const count = await service.clearRoomMute(["A", "room:A"], "u1");
  assert.equal(count, 1);
  const deletes = calls.filter((c) => /DELETE FROM room_mutes/.test(c.text));
  assert.equal(deletes.length, 1);
  assert.ok(deletes[0].values?.length === 3);
});

// ── خريطة الصلاحيات المشتركة ──
test("room_mute requires meiut edit or all", () => {
  assert.equal(canRunProfileAdminAction(["meiut.read"], "room_mute"), false);
  assert.equal(canRunProfileAdminAction(["meiut.edit"], "room_mute"), true);
  assert.equal(canRunProfileAdminAction(["meiut.all"], "room_mute"), true);
});

test("global_unmute requires the same mute permission", () => {
  assert.equal(canRunProfileAdminAction(["meiut.edit"], "global_unmute"), true);
  assert.equal(canRunProfileAdminAction(["kick.edit"], "global_unmute"), false);
});

test("room_unmute keeps requiring the mute permission", () => {
  assert.equal(canRunProfileAdminAction(["meiut.edit"], "room_unmute"), true);
  assert.equal(canRunProfileAdminAction(["meiut.read"], "room_unmute"), false);
});
