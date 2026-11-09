import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  cashAccounts,
  cashEntries,
  cashOperations,
} from "../server/db/schema";
import { ensureCashLedgerSchema } from "../server/db/migrate";

test("cash accounts keep currency and legal owner explicit and separate from coin balances", () => {
  const config = getTableConfig(cashAccounts);
  const columns = new Set(config.columns.map((column) => column.name));
  const checks = new Set(config.checks.map((constraint) => constraint.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.equal(config.name, "cash_accounts");
  for (const column of [
    "owner_type",
    "owner_user_id",
    "owner_agent_id",
    "owner_reference",
    "bucket",
    "currency_code",
    "balance_minor_units",
  ]) {
    assert.ok(columns.has(column), `${column} is required`);
  }
  assert.ok(checks.has("cash_accounts_owner_check"));
  assert.ok(checks.has("cash_accounts_currency_check"));
  assert.ok(checks.has("cash_accounts_nonnegative_check"));
  assert.equal(indexes.get("cash_accounts_member_bucket_currency_idx")?.unique, true);
  assert.equal(indexes.get("cash_accounts_system_bucket_currency_idx")?.unique, true);
  const ownerCheck = config.checks.find((constraint) => constraint.name === "cash_accounts_owner_check");
  assert.ok(ownerCheck);
});

test("cash operations and entries enforce idempotency and append-only reversal links", () => {
  const operations = getTableConfig(cashOperations);
  const operationColumns = new Set(operations.columns.map((column) => column.name));
  const operationIndexes = new Map(operations.indexes.map((index) => [index.config.name, index.config]));
  const entries = getTableConfig(cashEntries);
  const entryColumns = new Set(entries.columns.map((column) => column.name));
  const entryIndexes = new Map(entries.indexes.map((index) => [index.config.name, index.config]));

  assert.ok(operationColumns.has("currency_code"));
  assert.ok(operationColumns.has("request_fingerprint"));
  assert.equal(operationIndexes.get("cash_operations_system_idempotency_idx")?.unique, true);
  assert.equal(operationIndexes.get("cash_operations_member_idempotency_idx")?.unique, true);
  assert.ok(entryColumns.has("amount_minor_units"));
  assert.ok(entryColumns.has("reversal_of_entry_id"));
  assert.equal(entryIndexes.get("cash_entries_operation_account_idx")?.unique, true);
  assert.equal(entryIndexes.get("cash_entries_reversal_once_idx")?.unique, true);
});

test("cash ledger migration creates only empty schema objects and ownership guards", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
  };

  await ensureCashLedgerSchema(client as unknown as import("pg").PoolClient);

  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS "cash_accounts"')));
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS "cash_operations"')));
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS "cash_entries"')));
  assert.ok(statements.some((sql) => sql.includes("ON DELETE RESTRICT")));
  assert.ok(statements.some((sql) => sql.includes("'withdrawable_balance'")));
  assert.ok(statements.some((sql) => sql.includes("'platform_cash_asset'")));
  assert.equal(statements.some((sql) => /INSERT INTO "cash_(?:accounts|operations|entries)"/.test(sql)), false);
});
