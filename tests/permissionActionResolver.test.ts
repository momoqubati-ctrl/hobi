import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolvePermissionKeys } from "../server/services/permissionActionResolver";

test("resource permissions resolve to the action matching the HTTP method", () => {
  assert.deepEqual(resolvePermissionKeys("ban", "GET"), ["ban.read", "ban.all"]);
  assert.deepEqual(resolvePermissionKeys("ban", "POST"), ["ban.edit", "ban.all"]);
  assert.deepEqual(resolvePermissionKeys("ban", "DELETE"), ["ban.delete", "ban.all"]);
});

test("admin theme routes resolve to their own read, edit, and delete permissions", () => {
  assert.deepEqual(resolvePermissionKeys("admin_profileframes", "GET"), ["admin_profileframes.read", "admin_profileframes.all"]);
  assert.deepEqual(resolvePermissionKeys("admin_profileframes", "POST"), ["admin_profileframes.edit", "admin_profileframes.all"]);
  assert.deepEqual(resolvePermissionKeys("admin_profileframes", "DELETE"), ["admin_profileframes.delete", "admin_profileframes.all"]);
  assert.deepEqual(resolvePermissionKeys("admin_membercardtheme", "GET"), ["admin_membercardtheme.read", "admin_membercardtheme.all"]);
  assert.deepEqual(resolvePermissionKeys("admin_membercardtheme", "POST"), ["admin_membercardtheme.edit", "admin_membercardtheme.all"]);
  assert.deepEqual(resolvePermissionKeys("admin_membercardtheme", "DELETE"), ["admin_membercardtheme.delete", "admin_membercardtheme.all"]);
});

test("explicit action keys are kept unchanged and owner is not a resource permission", () => {
  assert.deepEqual(resolvePermissionKeys("admin_roles.all", "POST"), ["admin_roles.all"]);
  assert.deepEqual(resolvePermissionKeys("owner", "GET"), []);
});
