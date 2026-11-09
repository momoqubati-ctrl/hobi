import assert from "node:assert/strict";
import test from "node:test";
import { filterProfileUpdatesByPermissions } from "../server/services/visualProfilePermissions";
import { expandAllPermissions } from "../server/services/permissionEngine";

test("socket profile updates require the matching visual permission", () => {
  const updates = {
    avatarFrameUrl: "/frame.webp",
    memberCardBgUrl: "#fff",
    profileMsg: "Hello",
  };

  assert.deepEqual(filterProfileUpdatesByPermissions(updates, []), {
    profileMsg: "Hello",
  });
  assert.deepEqual(filterProfileUpdatesByPermissions(updates, ["frame.use", "custombg.use"]), updates);
  assert.deepEqual(
    filterProfileUpdatesByPermissions(updates, new Set(["frame.use", "custombg.use"])),
    updates,
  );
});

test("socket profile updates allow clearing visual assets without use permission", () => {
  const updates = {
    avatarFrameUrl: "",
    memberCardBgUrl: "",
  };

  assert.deepEqual(filterProfileUpdatesByPermissions(updates, []), updates);
});

test("member-card images and colors require their own permissions", () => {
  const updates = {
    memberCardBgUrl: "/theme.webp",
  };

  assert.deepEqual(filterProfileUpdatesByPermissions(updates, ["custombg.use"]), {});
  assert.deepEqual(filterProfileUpdatesByPermissions(updates, ["chattem.use"]), updates);
});

test("trimmed color values cannot be sent through the image permission", () => {
  assert.deepEqual(
    filterProfileUpdatesByPermissions({ memberCardBgUrl: " #fff " }, ["chattem.use"]),
    {},
  );
});

test("all permissions include use for visual resources", () => {
  assert.equal(expandAllPermissions(new Set(["frame.all"])).has("frame.use"), true);
});
