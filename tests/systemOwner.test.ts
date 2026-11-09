import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canAssignSystemOwnerRole,
  isSystemOwnerUsername,
  isReservedOwnerRoleName,
} from "../server/services/systemOwner";

test("only the reserved Safarihost account can receive the system owner role", () => {
  assert.equal(isSystemOwnerUsername("Safarihost"), true);
  assert.equal(isSystemOwnerUsername("  SAFARIHOST  "), true);
  assert.equal(isSystemOwnerUsername("admin"), false);
  assert.equal(isSystemOwnerUsername("safarihost2"), false);
  assert.equal(canAssignSystemOwnerRole("safarihost"), true);
  assert.equal(canAssignSystemOwnerRole("another-user"), false);
});

test("owner role aliases are reserved from normal role creation", () => {
  assert.equal(isReservedOwnerRoleName("Owner"), true);
  assert.equal(isReservedOwnerRoleName(" ispower "), true);
  assert.equal(isReservedOwnerRoleName("مالك"), true);
  assert.equal(isReservedOwnerRoleName("moderator"), false);
});
