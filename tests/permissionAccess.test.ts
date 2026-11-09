import assert from "node:assert/strict";
import test from "node:test";
import { hasAllPermissionAccess, hasPermissionAccess } from "../src/lib/permissionAccess";

test("permission access requires the exact permission or its resource-wide grant", () => {
  assert.equal(hasPermissionAccess(["room_chat.use"], "room_chat.use"), true);
  assert.equal(hasPermissionAccess(["room_chat.all"], "room_chat.use"), true);
  assert.equal(hasPermissionAccess(["private_chat.use"], "room_chat.use"), false);
  assert.equal(hasPermissionAccess([], "room_chat.use"), false);
});

test("permission access never treats a different action as an implicit grant", () => {
  assert.equal(hasPermissionAccess(["ban.read"], "ban.edit"), false);
  assert.equal(hasPermissionAccess(["ban.all"], "ban.edit"), true);
  assert.equal(hasPermissionAccess(["ban.edit"], "ban.all"), false);
});

test("permission access rejects malformed permission keys", () => {
  assert.equal(hasPermissionAccess(["cp.all"], ""), false);
  assert.equal(hasPermissionAccess(["room_chat.use"], "room_chat"), false);
});

test("permission gates deny empty requirements", () => {
  assert.equal(hasAllPermissionAccess(["room_chat.use"], []), false);
});
