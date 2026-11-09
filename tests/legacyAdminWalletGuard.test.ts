import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isWalletFinancialTable,
  isWalletWriteFenceError,
} from "../server/services/legacyAdminService";

test("generic admin database writes cannot target wallet ledger tables", () => {
  assert.equal(isWalletFinancialTable("wallet_settings"), true);
  assert.equal(isWalletFinancialTable("wallet_agents"), true);
  assert.equal(isWalletFinancialTable("wallet_operations"), true);
  assert.equal(isWalletFinancialTable("wallet_balances"), true);
  assert.equal(isWalletFinancialTable("wallet_entries"), true);
  assert.equal(isWalletFinancialTable("gift_transactions"), false);
  assert.equal(isWalletFinancialTable("user_profiles"), false);
});

test("legacy coin fence errors can be distinguished from other database errors", () => {
  assert.equal(isWalletWriteFenceError({ code: "55000" }), true);
  assert.equal(isWalletWriteFenceError({ code: "23505" }), false);
  assert.equal(isWalletWriteFenceError("55000"), false);
});
