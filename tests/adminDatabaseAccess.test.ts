import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminDatabaseAccessError,
  deleteTableRow,
  getVisibleAdminColumns,
  insertTableRow,
  isAdminColumnVisible,
  isAdminTableReadable,
  isAdminTableWritable,
  updateTableRow,
} from "../server/services/legacyAdminService";
import { getConfiguredAdminSecret } from "../server/services/adminAccess";

test("admin database reads omit credentials, tokens, and payment proof fields", () => {
  const columns = [
    { name: "username" },
    { name: "password_hash" },
    { name: "reset_token" },
    { name: "api_secret" },
    { name: "proof_object_key" },
    { name: "receipt_url" },
    { name: "refreshToken" },
    { name: "apiKeyEncrypted" },
    { name: "proofImage" },
    { name: "receiptUrl" },
  ];

  assert.deepEqual(getVisibleAdminColumns(columns).map((column) => column.name), ["username"]);
  assert.equal(isAdminColumnVisible("access_token"), false);
  assert.equal(isAdminColumnVisible("avatar_url"), true);
});

test("generic database editor cannot write financial, identity, or gift-ledger tables", () => {
  for (const tableName of [
    "cash_accounts",
    "cash_entries",
    "cash_operations",
    "wallet_balances",
    "wallet_entries",
    "wallet_operations",
    "member_coin_purchases",
    "gift_transactions",
    "users",
    "user_profiles",
    "files",
    "site_settings",
  ]) {
    assert.equal(isAdminTableWritable(tableName), false, `${tableName} must be service-managed`);
  }
  assert.equal(isAdminTableWritable("room_badges"), true);
});

test("generic database editor does not expose unstructured verification or secret records", () => {
  assert.equal(isAdminTableReadable("user_verifications"), false);
  assert.equal(isAdminTableReadable("voice_provider_accounts"), false);
  assert.equal(isAdminTableReadable("admin_audit_logs"), false);
  assert.equal(isAdminTableReadable("files"), false);
  assert.equal(isAdminTableReadable("site_settings"), false);
  assert.equal(isAdminTableReadable("room_badges"), true);
});

test("admin database CRUD helpers enforce the protected table policy", async () => {
  await assert.rejects(insertTableRow("wallet_balances", {}), AdminDatabaseAccessError);
  await assert.rejects(updateTableRow("users", "id", "member-1", { username: "other" }), AdminDatabaseAccessError);
  await assert.rejects(deleteTableRow("gift_transactions", "id", "gift-1"), AdminDatabaseAccessError);
});

test("admin authentication requires an explicit configured secret", () => {
  assert.equal(getConfiguredAdminSecret({}), null);
  assert.equal(
    getConfiguredAdminSecret({ AUTH_SECRET: "dev-only-change-this-secret" }),
    null,
  );
  assert.equal(getConfiguredAdminSecret({ AUTH_SECRET: "configured-test-secret" }), "configured-test-secret");
});
