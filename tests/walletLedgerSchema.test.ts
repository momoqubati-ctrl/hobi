import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  ensureFinancialWalletAccountsSchema,
} from "../server/db/migrate";
import {
  walletBalances,
  walletEntries,
  walletAgents,
  walletOperations,
  walletSettings,
} from "../server/db/schema";
import { ensureWalletLedgerSchema } from "../server/db/migrate";

test("wallet settings have an isolated protected storage table", () => {
  const config = getTableConfig(walletSettings);
  const columnNames = config.columns.map((column) => column.name);

  assert.equal(config.name, "wallet_settings");
  assert.ok(columnNames.includes("key"));
  assert.ok(columnNames.includes("value"));
  assert.ok(columnNames.includes("updated_by"));
  assert.ok(columnNames.includes("updated_at"));
});

test("wallet agent accounts store only protected password hashes and force initial password changes", () => {
  const config = getTableConfig(walletAgents);
  const columnNames = config.columns.map((column) => column.name);
  const checks = new Set(config.checks.map((constraint) => constraint.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.equal(config.name, "wallet_agents");
  assert.ok(columnNames.includes("password_hash"));
  assert.ok(columnNames.includes("phone"));
  assert.ok(columnNames.includes("force_password_change"));
  assert.equal(indexes.get("wallet_agents_username_idx")?.unique, true);
  assert.ok(checks.has("wallet_agents_username_lowercase_check"));
  assert.ok(checks.has("wallet_agents_status_check"));
});

test("wallet operation schema scopes idempotency and records request fingerprints", () => {
  const config = getTableConfig(walletOperations);
  const columnNames = config.columns.map((column) => column.name);
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.equal(config.name, "wallet_operations");
  assert.ok(columnNames.includes("actor_scope"));
  assert.ok(columnNames.includes("actor_user_id"));
  assert.ok(columnNames.includes("idempotency_key"));
  assert.ok(columnNames.includes("request_fingerprint"));
  assert.ok(columnNames.includes("metadata"));
  assert.equal(
    config.columns.find((column) => column.name === "request_fingerprint")?.getSQLType(),
    "varchar(64)",
  );
  assert.equal(indexes.get("wallet_operations_actor_idempotency_idx")?.unique, true);
  assert.equal(indexes.get("wallet_operations_system_idempotency_idx")?.unique, true);
  assert.ok(indexes.get("wallet_operations_actor_idempotency_idx")?.where);
  assert.ok(indexes.get("wallet_operations_system_idempotency_idx")?.where);
  assert.equal(indexes.get("wallet_operations_site_funding_reference_idx")?.unique, true);
  assert.ok(indexes.get("wallet_operations_site_funding_reference_idx")?.where);
});

test("wallet balance schema constrains member accounts and separates system buckets", () => {
  const config = getTableConfig(walletBalances);
  const columnNames = config.columns.map((column) => column.name);
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));
  const checks = new Set(config.checks.map((constraint) => constraint.name));

  assert.equal(config.name, "wallet_balances");
  assert.ok(columnNames.includes("account_type"));
  assert.ok(columnNames.includes("bucket"));
  assert.ok(columnNames.includes("balance_coins"));
  assert.equal(
    config.columns.find((column) => column.name === "balance_coins")?.getSQLType(),
    "bigint",
  );
  assert.equal(indexes.get("wallet_balances_member_bucket_idx")?.unique, true);
  assert.equal(indexes.get("wallet_balances_system_bucket_idx")?.unique, true);
  assert.ok(checks.has("wallet_balances_bucket_check"));
  assert.ok(checks.has("wallet_balances_member_nonnegative_check"));
  assert.ok(checks.has("wallet_balances_site_inventory_nonnegative_check"));
});

test("wallet balances represent distinct purchase, earnings, conversion, site-owner, and agent wallets", () => {
  const config = getTableConfig(walletBalances);
  const bucketCheck = config.checks.find((constraint) => constraint.name === "wallet_balances_bucket_check");
  const sql = bucketCheck?.value.queryChunks
    .filter((chunk): chunk is { value: string[] } =>
      typeof chunk === "object" &&
      chunk !== null &&
      "value" in chunk &&
      Array.isArray(chunk.value),
    )
    .map((chunk) => chunk.value.join(""))
    .join("") ?? "";

  for (const bucket of [
    "purchased_spendable",
    "gift_earnings_spendable",
    "conversion_escrow",
    "site_profit",
    "agent_profit",
  ]) {
    assert.ok(sql.includes(bucket), `${bucket} must be a distinct wallet bucket`);
  }
  assert.ok(sql.includes("'site_owner'"), "site-owner accounts must be distinct from system inventory");
  assert.ok(config.indexes.some((index) => index.config.name === "wallet_balances_site_owner_bucket_idx"));
});

test("financial wallet account migration adds buckets without seeding or changing balances", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
  };

  await ensureFinancialWalletAccountsSchema(client as unknown as import("pg").PoolClient);

  const sql = statements.join("\n");
  assert.match(sql, /'purchased_spendable'/);
  assert.match(sql, /'gift_earnings_spendable'/);
  assert.match(sql, /'conversion_escrow'/);
  assert.match(sql, /'site_owner'/);
  assert.match(sql, /'site_profit'/);
  assert.match(sql, /'agent_profit'/);
  assert.doesNotMatch(sql, /INSERT INTO "wallet_balances"/);
  assert.doesNotMatch(sql, /UPDATE "wallet_balances"\s+SET "balance_coins"/);
});

test("wallet migrations preserve member ownership references when users are deleted", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
  };

  await ensureWalletLedgerSchema(client as unknown as import("pg").PoolClient);

  assert.ok(statements.some((statement) =>
    statement.includes('"wallet_balances_user_id_users_id_fk') &&
    statement.includes("ON DELETE RESTRICT"),
  ));
  assert.ok(statements.some((statement) =>
    statement.includes('"wallet_operations_actor_user_id_users_id_fk') &&
    statement.includes("ON DELETE RESTRICT"),
  ));
});

test("wallet entry schema links postings and permits only one full reversal per entry", () => {
  const config = getTableConfig(walletEntries);
  const columnNames = config.columns.map((column) => column.name);
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));
  const checks = new Set(config.checks.map((constraint) => constraint.name));

  assert.equal(config.name, "wallet_entries");
  assert.ok(columnNames.includes("operation_id"));
  assert.ok(columnNames.includes("wallet_balance_id"));
  assert.ok(columnNames.includes("amount"));
  assert.ok(columnNames.includes("reversal_of_entry_id"));
  assert.equal(indexes.get("wallet_entries_operation_account_idx")?.unique, true);
  assert.equal(indexes.get("wallet_entries_reversal_once_idx")?.unique, true);
  assert.ok(indexes.get("wallet_entries_reversal_once_idx")?.where);
  assert.ok(checks.has("wallet_entries_nonzero_amount_check"));
});
