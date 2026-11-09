import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueToken, verifyAuthToken } from "../server/services/authService";
import {
  canAccessVoiceRoom,
  canPublishFromSeat,
  getVoiceTokenPermissions,
} from "../server/services/voiceTokenAccess";

const signClaims = (claims: unknown) => {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const secret = process.env.AUTH_SECRET || "dev-only-change-this-secret";
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
};

test("voice token auth accepts a valid signed, unexpired session", () => {
  const token = issueToken({ id: "user-1", username: "member", role: "member" });
  const claims = verifyAuthToken(token);

  assert.ok(claims);
  assert.strictEqual(claims.sub, "user-1");
  assert.strictEqual(claims.username, "member");
  assert.strictEqual(claims.role, "member");
  assert.ok(Number.isFinite(claims.exp));
});

test("owner claims are reserved for the Safarihost account", () => {
  const forgedOwner = verifyAuthToken(issueToken({ id: "user-2", username: "member", role: "owner" }));
  const legacyOwnerName = verifyAuthToken(issueToken({ id: "user-3", username: "admin", role: "owner" }));
  const systemOwner = verifyAuthToken(issueToken({ id: "owner-1", username: "Safarihost", role: "member" }));

  assert.equal(forgedOwner?.role, "admin");
  assert.equal(legacyOwnerName?.role, "admin");
  assert.equal(systemOwner?.role, "owner");
});

test("voice token auth rejects malformed and tampered session tokens", () => {
  const token = issueToken({ id: "user-1", username: "member", role: "member" });
  const [payload, signature] = token.split(".");
  const tampered = `${payload}.${signature.slice(0, -1)}x`;

  assert.strictEqual(verifyAuthToken("not-a-token"), null);
  assert.strictEqual(verifyAuthToken(tampered), null);
});

test("voice token auth requires a numeric unexpired expiration claim", () => {
  assert.strictEqual(
    verifyAuthToken(signClaims({ sub: "user-1", username: "member", role: "member" })),
    null,
  );
  assert.strictEqual(
    verifyAuthToken(
      signClaims({ sub: "user-1", username: "member", role: "member", exp: Date.now() + 60_000 }),
      Number.MAX_SAFE_INTEGER,
    ),
    null,
  );
});

test("voice token auth rejects signed payloads that are not claim objects", () => {
  assert.strictEqual(verifyAuthToken(signClaims(null)), null);
  assert.strictEqual(verifyAuthToken(signClaims([])), null);
});

test("voice token permissions deny callers who are not present in the room", () => {
  assert.strictEqual(getVoiceTokenPermissions(false), null);
});

test("voice token permissions allow publishing only for an eligible seated room member", () => {
  assert.deepStrictEqual(getVoiceTokenPermissions(true, true), {
    canJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: false,
  });
  assert.deepStrictEqual(getVoiceTokenPermissions(true, false), {
    canJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
  });
  assert.strictEqual(getVoiceTokenPermissions(false, true), null);
});

test("voice seat publishing excludes muted seats, guests, and seats without role data", () => {
  const memberSeat = { isMuted: false, role: "member" };
  assert.strictEqual(canPublishFromSeat(memberSeat, "member"), true);
  assert.strictEqual(canPublishFromSeat({ ...memberSeat, isMuted: true }, "member"), false);
  assert.strictEqual(canPublishFromSeat({ ...memberSeat, accountMuted: true }, "member"), false);
  assert.strictEqual(canPublishFromSeat(memberSeat, "guest"), false);
  assert.strictEqual(canPublishFromSeat({ isMuted: false }, "member"), false);
});

test("canAccessVoiceRoom enforces fail-closed authorization checks", () => {
  assert.strictEqual(canAccessVoiceRoom({ isRoomMember: false }), false);
  assert.strictEqual(canAccessVoiceRoom({ isRoomMember: true, isKickedOrBanned: true }), false);
  assert.strictEqual(canAccessVoiceRoom({ isRoomMember: true, accountStatus: "banned" }), false);
  assert.strictEqual(canAccessVoiceRoom({ isRoomMember: true, accountStatus: "suspended" }), false);
  assert.strictEqual(canAccessVoiceRoom({ isRoomMember: true, accountStatus: "active" }), true);
  assert.strictEqual(canAccessVoiceRoom({ isRoomMember: true }), true);
});
