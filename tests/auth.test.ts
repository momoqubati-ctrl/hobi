import test from "node:test";
import assert from "node:assert";
import { createGuestSession, findInMemoryUser, registerMember } from "../server/services/authService";
import { addConnectedUser, getConnectedUser, removeUserPresenceByUserId } from "../server/socket/presenceManager";

test("Auth - should create guest session with valid token and public user", async () => {
  const session = await createGuestSession("زائر_تجريبي", "SA");
  
  assert.ok(session.token, "Token should be issued");
  assert.ok(session.token.includes("."), "Token should be formatted as payload.signature");
  assert.ok(session.user, "User object should exist");
  assert.strictEqual(session.user.role, "guest");
  assert.strictEqual(session.user.countryCode, "SA");
  assert.ok(session.user.username.startsWith("guest-"), "Guest username should have guest- prefix");
  assert.strictEqual(session.user.name, "زائر_تجريبي");
});

test("Auth - findInMemoryUser should locate created guest session", async () => {
  const session = await createGuestSession("أحمد_المختبر", "EG");
  const found = findInMemoryUser(session.user.username);
  
  assert.ok(found, "User should be found in memory store");
  assert.strictEqual(found?.id, session.user.id);
  assert.strictEqual(found?.displayName, "أحمد_المختبر");
});

test("Auth - Safarihost username is reserved for the system owner account", async () => {
  const result = await registerMember({ username: "  SAFARIHOST ", password: "example-password" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "USERNAME_RESERVED");
  }
});

test("Auth - removeUserPresenceByUserId should terminate presence across all sessions", async () => {
  const testUserId = "user-test-session-123";
  const sid1 = "mock-socket-1";
  const sid2 = "mock-socket-2";

  await addConnectedUser(sid1, {
    id: testUserId,
    username: "مستخدم_تجريبي_1",
    role: "member",
    avatar: "/pic.png",
    countryCode: "SA",
    avatarFrameUrl: "",
    giftIconUrl: "",
    memberCardBgUrl: "",
    nameColor: "",
    messageColor: "",
    statusFontColor: "",
    messageBubbleStyle: "default",
    roomId: "",
    connectedAt: new Date().toISOString(),
    status: "online",
    idreg: "",
    siteBadge: "",
    statusMsg: "",
    giftedBannerUrl: "",
    giftedGiftIconUrl: "",
    giftedPromotionIconUrl: "",
    roleIconUrl: "",
    youtubeUrl: "",
  });

  await addConnectedUser(sid2, {
    id: testUserId,
    username: "مستخدم_تجريبي_1",
    role: "member",
    avatar: "/pic.png",
    countryCode: "SA",
    avatarFrameUrl: "",
    giftIconUrl: "",
    memberCardBgUrl: "",
    nameColor: "",
    messageColor: "",
    statusFontColor: "",
    messageBubbleStyle: "default",
    roomId: "",
    connectedAt: new Date().toISOString(),
    status: "online",
    idreg: "",
    siteBadge: "",
    statusMsg: "",
    giftedBannerUrl: "",
    giftedGiftIconUrl: "",
    giftedPromotionIconUrl: "",
    roleIconUrl: "",
    youtubeUrl: "",
  });

  const u1Before = await getConnectedUser(sid1);
  const u2Before = await getConnectedUser(sid2);
  assert.ok(u1Before, "Socket 1 should be present before removal");
  assert.ok(u2Before, "Socket 2 should be present before removal");

  const removedIds = await removeUserPresenceByUserId(testUserId);
  assert.ok(removedIds.includes(sid1), "Socket 1 should be removed");
  assert.ok(removedIds.includes(sid2), "Socket 2 should be removed");

  const u1After = await getConnectedUser(sid1);
  const u2After = await getConnectedUser(sid2);
  assert.strictEqual(u1After, undefined, "Socket 1 should no longer be present");
  assert.strictEqual(u2After, undefined, "Socket 2 should no longer be present");
});
