import assert from "node:assert/strict";
import test from "node:test";
import { canRunProfileAdminAction } from "../src/lib/profileAdminPermissions";

test("profile mutations require edit or all, not read", () => {
  assert.equal(canRunProfileAdminAction(["kick.read"], "kick"), false);
  assert.equal(canRunProfileAdminAction(["kick.edit"], "kick"), true);
  assert.equal(canRunProfileAdminAction(["kick.all"], "kick"), true);
});

test("read-only profile history is accessible through its read permission", () => {
  assert.equal(canRunProfileAdminAction(["history.read"], "history"), true);
  assert.equal(canRunProfileAdminAction(["history.edit"], "history"), false);
  assert.equal(canRunProfileAdminAction(["history.read"], "ban"), false);
});

test("delete_pic uses delpic and pull_to_room uses rooms", () => {
  assert.equal(canRunProfileAdminAction(["delpic.edit"], "delete_pic"), true);
  assert.equal(canRunProfileAdminAction(["kick.edit"], "delete_pic"), false);
  assert.equal(canRunProfileAdminAction(["rooms.edit"], "pull_to_room"), true);
  assert.equal(canRunProfileAdminAction(["loveu.edit"], "pull_to_room"), false);
});

test("unknown profile actions are denied", () => {
  assert.equal(canRunProfileAdminAction(["kick.all"], "unknown"), false);
});
