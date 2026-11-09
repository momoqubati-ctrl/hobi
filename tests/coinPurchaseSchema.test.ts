import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import {
  memberCoinPurchases,
  walletAgentInventoryOrders,
  walletAgentPackages,
  walletBalances,
  walletOperations,
} from "../server/db/schema";
import { ensureCoinPurchaseSchema } from "../server/db/migrate";
import {
  assertCoinPurchaseIndexesReady,
  assertCoinPurchaseMigrationTarget,
  assertCoinPurchaseSchemaSignatureMatches,
} from "../scripts/migrate-coin-purchases.mjs";

test("re-running the purchase migration rejects a drifted schema signature", () => {
  assert.doesNotThrow(() => assertCoinPurchaseSchemaSignatureMatches("signature-v1", "signature-v1"));
  assert.throws(
    () => assertCoinPurchaseSchemaSignatureMatches("signature-v2", "signature-v1"),
    /schema has drifted/,
  );
  assert.throws(
    () => assertCoinPurchaseSchemaSignatureMatches("signature-v1", undefined),
    /schema has drifted/,
  );
});

test("migration target validation depends on the explicit public schema, not current search path", () => {
  assert.doesNotThrow(() =>
    assertCoinPurchaseMigrationTarget({
      database_name: "chat_app",
      public_schema_exists: true,
    }),
  );
  assert.throws(
    () =>
      assertCoinPurchaseMigrationTarget({
        database_name: "other_database",
        public_schema_exists: true,
      }),
    /expected the chat_app database and public schema/,
  );
});

test("migration refuses missing or invalid purchase indexes", async () => {
  let invalidIndexes = [{ index_name: "wallet_balances_agent_inventory_idx" }];
  const client = {
    async query() {
      return { rows: invalidIndexes };
    },
  } as unknown as PoolClient;

  await assert.rejects(() => assertCoinPurchaseIndexesReady(client), /missing or invalid/);
  invalidIndexes = [];
  await assert.doesNotReject(() => assertCoinPurchaseIndexesReady(client));
});

test("wallet ledger separates agent inventory accounts from member and system balances", () => {
  const config = getTableConfig(walletBalances);
  const columnNames = config.columns.map((column) => column.name);
  const checks = new Set(config.checks.map((constraint) => constraint.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.ok(columnNames.includes("agent_id"));
  assert.ok(checks.has("wallet_balances_agent_inventory_nonnegative_check"));
  assert.ok(indexes.get("wallet_balances_agent_inventory_idx")?.unique);
});

test("wallet operations scope agent idempotency keys to the authenticated agent", () => {
  const config = getTableConfig(walletOperations);
  const columnNames = config.columns.map((column) => column.name);
  const checks = new Set(config.checks.map((constraint) => constraint.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.ok(columnNames.includes("actor_agent_id"));
  assert.ok(checks.has("wallet_operations_actor_scope_check"));
  assert.ok(indexes.get("wallet_operations_agent_idempotency_idx")?.unique);
  assert.ok(indexes.get("wallet_operations_agent_inventory_reference_idx")?.unique);
  assert.ok(indexes.get("wallet_operations_member_coin_purchase_reference_idx")?.unique);
});

test("agent packages constrain per-agent coin amounts, fiat values, and currencies", () => {
  const config = getTableConfig(walletAgentPackages);
  const columnNames = config.columns.map((column) => column.name);
  const checks = new Set(config.checks.map((constraint) => constraint.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.equal(config.name, "wallet_agent_packages");
  assert.ok(columnNames.includes("agent_id"));
  assert.ok(columnNames.includes("coin_amount"));
  assert.ok(columnNames.includes("price_minor_units"));
  assert.ok(columnNames.includes("currency_code"));
  assert.ok(checks.has("wallet_agent_packages_coin_amount_check"));
  assert.ok(checks.has("wallet_agent_packages_price_check"));
  assert.ok(checks.has("wallet_agent_packages_currency_check"));
  assert.ok(indexes.get("wallet_agent_packages_agent_amount_idx")?.unique);
});

test("agent inventory requests and member purchases persist private proof keys and auditable states", () => {
  const inventory = getTableConfig(walletAgentInventoryOrders);
  const purchases = getTableConfig(memberCoinPurchases);
  const inventoryColumns = inventory.columns.map((column) => column.name);
  const purchaseColumns = purchases.columns.map((column) => column.name);

  assert.equal(inventory.name, "wallet_agent_inventory_orders");
  assert.ok(inventoryColumns.includes("agent_id"));
  assert.ok(inventoryColumns.includes("proof_object_key"));
  assert.ok(inventoryColumns.includes("proof_uploaded_at"));
  assert.ok(inventoryColumns.includes("payment_reference"));
  assert.ok(inventoryColumns.includes("status"));
  assert.ok(inventoryColumns.includes("quoted_price_minor_units"));
  assert.ok(inventoryColumns.includes("currency_code"));
  assert.ok(inventoryColumns.includes("quoted_by_user_id"));
  assert.ok(inventoryColumns.includes("settlement_operation_id"));
  const inventoryChecks = new Set(inventory.checks.map((constraint) => constraint.name));
  assert.ok(inventoryChecks.has("wallet_agent_inventory_orders_quote_check"));
  assert.ok(inventoryChecks.has("wallet_agent_inventory_orders_payment_proof_check"));

  assert.equal(purchases.name, "member_coin_purchases");
  assert.ok(purchaseColumns.includes("member_user_id"));
  assert.ok(purchaseColumns.includes("agent_id"));
  assert.ok(purchaseColumns.includes("coin_amount"));
  assert.ok(purchaseColumns.includes("price_minor_units"));
  assert.ok(purchaseColumns.includes("currency_code"));
  assert.ok(purchaseColumns.includes("payment_instructions_snapshot"));
  assert.ok(purchaseColumns.includes("proof_object_key"));
  assert.ok(purchaseColumns.includes("proof_uploaded_at"));
  assert.ok(purchaseColumns.includes("receipt_expires_at"));
  assert.ok(purchaseColumns.includes("reviewed_by_agent_id"));
  assert.ok(purchaseColumns.includes("settlement_operation_id"));
});

test("coin purchase schema migration is additive and does not create wallet balances", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await ensureCoinPurchaseSchema(client);

  const sql = statements.join("\n");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "agent_id"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "actor_agent_id"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "wallet_agent_packages"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "wallet_agent_inventory_orders"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "member_coin_purchases"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "proof_uploaded_at"/);
  assert.doesNotMatch(sql, /position\('agent' IN scope_constraint\)/);
  assert.doesNotMatch(sql, /position\('agent_inventory' IN bucket_constraint\)/);
  assert.doesNotMatch(sql, /INSERT INTO "wallet_balances"/);
  assert.doesNotMatch(sql, /legacy-opening-v1/);
  assert.doesNotMatch(sql, /INSERT INTO "wallet_operations"/);
});
