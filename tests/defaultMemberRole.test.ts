import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_MEMBER_ROLE_NAME,
  DEFAULT_MEMBER_ROLE_PERMISSIONS,
  shouldAssignDefaultMemberRole,
} from "../server/services/defaultMemberRole";
import { DEFAULT_CHAT_FEATURE_PERMISSION_KEYS } from "../src/lib/chatFeaturePermissions";

test("role permission migrations use valid JSONB boolean literals", () => {
  const migrationSource = readFileSync(join(process.cwd(), "server", "db", "migrate.ts"), "utf8");

  assert.doesNotMatch(migrationSource, /(?<!['"])true::jsonb/);
  assert.match(migrationSource, /'true'::jsonb/);
});

test("the default member role grants only the selected basic profile features", () => {
  assert.equal(DEFAULT_MEMBER_ROLE_NAME, "__system_default_member__");
  assert.deepEqual(DEFAULT_MEMBER_ROLE_PERMISSIONS, [
    "frame.use",
    "custombg.use",
    "chattem.use",
  ]);
  assert.equal(DEFAULT_MEMBER_ROLE_PERMISSIONS.some((key) => key.startsWith("admin_")), false);
});

test("only registered members receive the default role", () => {
  assert.equal(shouldAssignDefaultMemberRole("member"), true);
  assert.equal(shouldAssignDefaultMemberRole(" MEMBER "), true);
  assert.equal(shouldAssignDefaultMemberRole("guest"), false);
  assert.equal(shouldAssignDefaultMemberRole("owner"), false);
  assert.equal(shouldAssignDefaultMemberRole("admin"), false);
});

test("the one-time chat migration preserves common chat features but excludes moderation", () => {
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("room_chat.use"));
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("private_voice_call.use"));
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("private_video_call.use"));
  assert.ok(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("story_publish.use"));
  assert.equal(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.includes("room_voice_moderation.use"), false);
  assert.equal(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS.some((key) => ["ban.edit", "kick.edit", "meiut.edit"].includes(key)), false);
});
