import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_FEATURE_GROUPS,
  CHAT_FEATURE_PERMISSION_KEYS,
  DEFAULT_CHAT_FEATURE_PERMISSION_KEYS,
  isValidAnnouncementDailyLimit,
  hasAllRequiredPermissions,
  getChatUploadPermissionRequirements,
  getMessagePermissionRequirements,
  getPrivateCallPermission,
} from "../src/lib/chatFeaturePermissions";
import { isPermissionActionImplemented } from "../src/components/admin/powers/permissionDefs";
import { hasChatFeatureAccess } from "../server/services/chatAuthorization";

test("announcement permissions are independently assignable and denied by default", () => {
  const expectedResources = ["announcement_all", "announcement_ranked", "announcement_room"];
  const announcementGroup = CHAT_FEATURE_GROUPS.find((group) => group.label === "الإعلانات");

  assert.deepEqual(
    announcementGroup?.resources.map(({ key }) => key),
    expectedResources,
  );
  for (const resource of expectedResources) {
    assert.equal(isPermissionActionImplemented(resource, "use"), true);
    assert.equal(
      DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.some((permission) => permission === `${resource}.use`),
      false,
    );
  }
});

test("announcement daily limits accept only whole numbers from zero through one thousand", () => {
  assert.equal(isValidAnnouncementDailyLimit(0), true);
  assert.equal(isValidAnnouncementDailyLimit(1000), true);
  assert.equal(isValidAnnouncementDailyLimit(-1), false);
  assert.equal(isValidAnnouncementDailyLimit(1001), false);
  assert.equal(isValidAnnouncementDailyLimit(1.5), false);
  assert.equal(isValidAnnouncementDailyLimit("5"), false);
});

test("chat feature permissions are available as use-only role controls", () => {
  assert.ok(CHAT_FEATURE_PERMISSION_KEYS.length > 0);
  for (const permission of CHAT_FEATURE_PERMISSION_KEYS) {
    const [resource, action] = permission.split(".");
    assert.equal(action, "use");
    assert.equal(isPermissionActionImplemented(resource, action), true);
  }
});

test("default chat permissions preserve common member features without moderation", () => {
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("room_chat.use"));
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("private_voice_call.use"));
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("private_video_call.use"));
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("story_publish.use"));
  assert.ok(!DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.some((key) => key.startsWith("moderation_")));
});

test("message permissions separate text, media, audio, and YouTube by channel", () => {
  assert.deepEqual(getMessagePermissionRequirements({ channel: "room", text: "hello" }), ["room_chat.use"]);
  assert.deepEqual(getMessagePermissionRequirements({ channel: "room", text: "https://youtu.be/video" }), [
    "room_chat.use",
    "room_youtube.use",
  ]);
  assert.deepEqual(getMessagePermissionRequirements({ channel: "private", mediaType: "image" }), [
    "private_chat.use",
    "private_media.use",
  ]);
  assert.deepEqual(getMessagePermissionRequirements({ channel: "private", mediaType: "audio" }), [
    "private_chat.use",
    "private_media.use",
    "private_audio_message.use",
  ]);
  assert.deepEqual(getMessagePermissionRequirements({ channel: "room", mediaType: "audio" }), [
    "room_chat.use",
    "room_media.use",
    "room_audio_message.use",
  ]);
  assert.deepEqual(getMessagePermissionRequirements({ channel: "wall", text: "https://youtube.com/watch?v=video" }), [
    "wall_posts.use",
    "wall_youtube.use",
  ]);
});

test("uploaded chat media requires the channel permission matching its media type", () => {
  assert.deepEqual(getChatUploadPermissionRequirements("wall_post", "image"), [
    "wall_posts.use",
    "wall_media.use",
  ]);
  assert.deepEqual(getChatUploadPermissionRequirements("room_message", "video"), [
    "room_chat.use",
    "room_media.use",
  ]);
  assert.deepEqual(getChatUploadPermissionRequirements("room_message", "audio"), [
    "room_chat.use",
    "room_media.use",
    "room_audio_message.use",
  ]);
});

test("permission evaluation denies any feature missing from the assigned groups", () => {
  assert.equal(hasAllRequiredPermissions(new Set(["room_chat.use"]), ["room_chat.use"]), true);
  assert.equal(hasAllRequiredPermissions(new Set(["room_chat.use"]), ["room_chat.use", "room_youtube.use"]), false);
  assert.equal(
    hasAllRequiredPermissions(
      new Set(["room_chat.use", "room_audio_message.use"]),
      getMessagePermissionRequirements({ channel: "room", mediaType: "audio" }),
    ),
    false,
  );
});

test("private call modes have independent permissions and reject invalid modes", () => {
  assert.equal(getPrivateCallPermission("voice"), "private_voice_call.use");
  assert.equal(getPrivateCallPermission("video"), "private_video_call.use");
  assert.equal(getPrivateCallPermission("screen"), null);
});

test("guests retain ordinary chat access but cannot use role-only moderation features", async () => {
  assert.equal(await hasChatFeatureAccess({ id: "guest-1", role: "guest" }, ["room_chat.use"]), true);
  assert.equal(await hasChatFeatureAccess({ id: "guest-1", role: "guest" }, ["room_voice_moderation.use"]), false);
});

test("hasChatFeatureAccess handles auth context with userId and privileged roles", async () => {
  assert.equal(await hasChatFeatureAccess({ userId: "admin-1", role: "admin" }, ["private_media.use"]), true);
  assert.equal(await hasChatFeatureAccess({ userId: "owner-1", role: "owner" }, ["private_media.use"]), true);
  assert.equal(await hasChatFeatureAccess({ userId: "mod-1", role: "ادمن" }, ["private_media.use"]), true);
});
