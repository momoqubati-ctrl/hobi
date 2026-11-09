import assert from "node:assert/strict";
import test from "node:test";
import { createAlertThrottle } from "../server/services/alertThrottle";
import { canRunProfileAdminAction } from "../src/lib/profileAdminPermissions";

test("throttle allows up to the configured limit inside the window", () => {
  const throttle = createAlertThrottle(new Map(), { maxPerWindow: 3, windowMs: 60_000 });
  assert.equal(throttle.allowAttempt("u1", 1000), true);
  assert.equal(throttle.allowAttempt("u1", 2000), true);
  assert.equal(throttle.allowAttempt("u1", 3000), true);
  assert.equal(throttle.allowAttempt("u1", 4000), false);
});

test("throttle is a sliding window: old attempts expire", () => {
  const throttle = createAlertThrottle(new Map(), { maxPerWindow: 2, windowMs: 60_000 });
  assert.equal(throttle.allowAttempt("u1", 0), true);
  assert.equal(throttle.allowAttempt("u1", 1000), true);
  assert.equal(throttle.allowAttempt("u1", 2000), false);
  // بعد مرور النافذة يُسمح مجدداً
  assert.equal(throttle.allowAttempt("u1", 61_000), true);
});

test("throttle is per-user", () => {
  const throttle = createAlertThrottle(new Map(), { maxPerWindow: 1, windowMs: 60_000 });
  assert.equal(throttle.allowAttempt("u1", 1000), true);
  assert.equal(throttle.allowAttempt("u2", 1000), true);
  assert.equal(throttle.allowAttempt("u1", 2000), false);
});

test("throttle refuses empty user id", () => {
  const throttle = createAlertThrottle();
  assert.equal(throttle.allowAttempt(""), false);
});

test("reset clears a user's history", () => {
  const throttle = createAlertThrottle(new Map(), { maxPerWindow: 1, windowMs: 60_000 });
  assert.equal(throttle.allowAttempt("u1", 1000), true);
  assert.equal(throttle.allowAttempt("u1", 2000), false);
  throttle.reset("u1");
  assert.equal(throttle.allowAttempt("u1", 3000), true);
});

// ── تحقق التسجيل بالمشترك: صورة send_alert gate ──
test("sending alert requires alert.edit or alert.all", () => {
  assert.equal(canRunProfileAdminAction(["alert.read"], "alert"), false);
  assert.equal(canRunProfileAdminAction(["alert.edit"], "alert"), true);
  assert.equal(canRunProfileAdminAction(["alert.all"], "alert"), true);
});

test("member without alert permission cannot send alerts", () => {
  assert.equal(canRunProfileAdminAction([], "alert"), false);
  assert.equal(canRunProfileAdminAction(["kick.all"], "alert"), false);
});

test("historic behavior unchanged for other admin actions", () => {
  assert.equal(canRunProfileAdminAction(["kick.edit"], "room_kick"), true);
  assert.equal(canRunProfileAdminAction(["meiut.edit"], "global_mute"), true);
});
