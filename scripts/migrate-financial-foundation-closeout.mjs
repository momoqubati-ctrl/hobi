#!/usr/bin/env node

import { config } from "dotenv";
import { createJiti } from "jiti";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertCoinPurchaseSchemaSignatureUpgradeCompatible,
  readCoinPurchaseSchemaSignature,
} from "./migrate-coin-purchases.mjs";
import { setMigrationSafetyTimeouts } from "./migration-safety.mjs";

config();

const REQUIRED_DATABASE = "chat_app";
const REQUIRED_CONFIRMATION = "apply-to-chat_app";
const MIGRATION_VERSION = "financial-foundation-v1";
const COIN_PURCHASE_MIGRATION_VERSION = "coin-purchases-v1";
const SIGNATURE_TABLES = [
  "wallet_balances",
  "wallet_operations",
  "wallet_entries",
  "cash_accounts",
  "cash_operations",
  "cash_entries",
];
const REQUIRED_BASELINE_TABLES = [
  "users",
  "wallet_agents",
  "wallet_balances",
  "wallet_operations",
  "wallet_entries",
];
const REQUIRED_BASELINE_COLUMNS = [
  ["wallet_balances", "agent_id"],
  ["wallet_operations", "actor_agent_id"],
];

export function assertFinancialFoundationMigrationTarget(identity) {
  if (
    identity?.database_name !== REQUIRED_DATABASE ||
    identity?.public_schema_exists !== true
  ) {
    throw new Error("Refusing to migrate: expected the chat_app database and public schema.");
  }
}

export async function assertFinancialFoundationBaseline(client) {
  const missingTables = await client.query(
    `
      SELECT required.name AS object_name
      FROM unnest($1::text[]) AS required(name)
      WHERE to_regclass('public.' || quote_ident(required.name)) IS NULL
      UNION ALL
      SELECT required.table_name || '.' || required.column_name
      FROM unnest($2::text[], $3::text[]) AS required(table_name, column_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM information_schema.columns AS column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = required.table_name
          AND column_info.column_name = required.column_name
      )
      ORDER BY object_name
    `,
    [
      REQUIRED_BASELINE_TABLES,
      REQUIRED_BASELINE_COLUMNS.map(([tableName]) => tableName),
      REQUIRED_BASELINE_COLUMNS.map(([, columnName]) => columnName),
    ],
  );
  if (missingTables.rows.length > 0) {
    throw new Error(
      `Refusing to migrate: wallet ledger baseline is incomplete (${missingTables.rows.map((row) => row.object_name).join(", ")}).`,
    );
  }
}

export async function readFinancialFoundationSchemaSignature(client) {
  const result = await client.query(
    `
      WITH schema_objects AS (
        SELECT
          'column' AS kind,
          column_info.table_name || '.' || column_info.column_name AS object_name,
          jsonb_build_object(
            'data_type', column_info.data_type,
            'udt_name', column_info.udt_name,
            'nullable', column_info.is_nullable,
            'max_length', column_info.character_maximum_length,
            'default', column_info.column_default
          )::text AS definition
        FROM information_schema.columns AS column_info
        WHERE column_info.table_schema = 'public'
          AND column_info.table_name = ANY($1::text[])

        UNION ALL

        SELECT
          'constraint',
          relation.relname || '.' || constraint_info.conname,
          jsonb_build_object(
            'type', constraint_info.contype,
            'definition', pg_get_constraintdef(constraint_info.oid, true),
            'validated', constraint_info.convalidated
          )::text
        FROM pg_constraint AS constraint_info
        JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY($1::text[])

        UNION ALL

        SELECT
          'index',
          relation.relname || '.' || index_relation.relname,
          jsonb_build_object(
            'definition', pg_get_indexdef(index_info.indexrelid),
            'valid', index_info.indisvalid,
            'ready', index_info.indisready,
            'live', index_info.indislive
          )::text
        FROM pg_index AS index_info
        JOIN pg_class AS relation ON relation.oid = index_info.indrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        JOIN pg_class AS index_relation ON index_relation.oid = index_info.indexrelid
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY($1::text[])

        UNION ALL

        SELECT
          'trigger',
          relation.relname || '.' || trigger_info.tgname,
          jsonb_build_object(
            'definition', pg_get_triggerdef(trigger_info.oid, true),
            'function', pg_get_functiondef(trigger_info.tgfoid)
          )::text
        FROM pg_trigger AS trigger_info
        JOIN pg_class AS relation ON relation.oid = trigger_info.tgrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY($1::text[])
          AND NOT trigger_info.tgisinternal
      )
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('kind', kind, 'name', object_name, 'definition', definition)
          ORDER BY kind, object_name
        ),
        '[]'::jsonb
      )::text AS signature
      FROM schema_objects
    `,
    [SIGNATURE_TABLES],
  );
  return result.rows[0]?.signature;
}

export function assertFinancialFoundationSchemaSignatureMatches(actual, expected) {
  if (typeof expected !== "string" || actual !== expected) {
    throw new Error("Refusing to continue: the installed financial foundation schema has drifted.");
  }
}

export async function prepareCoinPurchaseSchemaSignatureUpgrade(client) {
  const stateTable = await client.query(
    "SELECT to_regclass('public.coin_purchase_schema_migrations') AS table_name",
  );
  if (!stateTable.rows[0]?.table_name) return null;

  const installed = await client.query(
    `SELECT "schema_signature"
     FROM "coin_purchase_schema_migrations"
     WHERE "version" = $1`,
    [COIN_PURCHASE_MIGRATION_VERSION],
  );
  if (installed.rows.length !== 1) {
    throw new Error("Refusing to continue: coin purchase migration state is missing or ambiguous.");
  }

  const currentSignature = await readCoinPurchaseSchemaSignature(client);
  assertCoinPurchaseSchemaSignatureUpgradeCompatible(
    currentSignature,
    installed.rows[0].schema_signature,
  );
  return installed.rows[0].schema_signature;
}

export async function refreshCoinPurchaseSchemaSignature(client, previousSignature) {
  if (previousSignature === null) return;
  if (typeof previousSignature !== "string") {
    throw new Error("Refusing to continue: coin purchase migration signature is invalid.");
  }

  const currentSignature = await readCoinPurchaseSchemaSignature(client);
  const result = await client.query(
    `UPDATE "coin_purchase_schema_migrations"
     SET "schema_signature" = $2
     WHERE "version" = $1 AND "schema_signature" = $3`,
    [COIN_PURCHASE_MIGRATION_VERSION, currentSignature, previousSignature],
  );
  if (result.rowCount !== 1) {
    throw new Error("Refusing to continue: coin purchase migration state changed during closeout.");
  }
}

export async function readFinancialFoundationWalletBalanceSnapshot(client) {
  const result = await client.query(`
    SELECT "id", "account_type", "user_id", "agent_id", "bucket",
           "balance_coins"::text AS "balance_coins"
    FROM "wallet_balances"
    ORDER BY "id"
  `);
  return JSON.stringify(result.rows);
}

export async function readFinancialFoundationWalletEntrySnapshot(client) {
  const result = await client.query(`
    SELECT "id", "operation_id", "wallet_balance_id", "amount"::text AS "amount",
           "reversal_of_entry_id", "created_at"::text AS "created_at"
    FROM "wallet_entries"
    ORDER BY "id"
  `);
  return JSON.stringify(result.rows);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the financial foundation schema migration.");
  }
  if (process.env.FINANCIAL_FOUNDATION_MIGRATION_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(`Set FINANCIAL_FOUNDATION_MIGRATION_CONFIRM=${REQUIRED_CONFIRMATION} to confirm this migration.`);
  }

  const jiti = createJiti(import.meta.url);
  const { dbPool } = await jiti.import(join(process.cwd(), "server", "db", "index.ts"));
  const { ensureFinancialFoundationSchema } = await jiti.import(
    join(process.cwd(), "server", "db", "migrate.ts"),
  );
  const client = await dbPool.connect();

  try {
    const identity = await client.query(
      `SELECT current_database() AS database_name, to_regnamespace('public') IS NOT NULL AS public_schema_exists`,
    );
    assertFinancialFoundationMigrationTarget(identity.rows[0]);
    await assertFinancialFoundationBaseline(client);

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL search_path TO public, pg_catalog");
      await setMigrationSafetyTimeouts(client);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('hobi.coin-purchase-schema'), 1)",
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('hobi.financial-foundation-schema'), 1)",
      );
      const previousCoinPurchaseSignature =
        await prepareCoinPurchaseSchemaSignatureUpgrade(client);

      const stateTable = await client.query(
        "SELECT to_regclass('public.financial_foundation_schema_migrations') AS table_name",
      );
      if (stateTable.rows[0]?.table_name) {
        const installed = await client.query(
          `SELECT "schema_signature"
           FROM "financial_foundation_schema_migrations"
           WHERE "version" = $1`,
          [MIGRATION_VERSION],
        );
        if (installed.rows.length !== 1) {
          throw new Error("Refusing to continue: financial foundation migration state is missing or ambiguous.");
        }
        const currentSignature = await readFinancialFoundationSchemaSignature(client);
        assertFinancialFoundationSchemaSignatureMatches(
          currentSignature,
          installed.rows[0].schema_signature,
        );
        await client.query("COMMIT");
        console.log("Financial foundation schema is installed and matches its recorded signature.");
        return;
      }

      const balancesBefore = await readFinancialFoundationWalletBalanceSnapshot(client);
      const entriesBefore = await readFinancialFoundationWalletEntrySnapshot(client);
      await ensureFinancialFoundationSchema(client);
      const balancesAfter = await readFinancialFoundationWalletBalanceSnapshot(client);
      const entriesAfter = await readFinancialFoundationWalletEntrySnapshot(client);
      if (balancesAfter !== balancesBefore) {
        throw new Error("Refusing to commit: wallet balances changed during the schema migration.");
      }
      if (entriesAfter !== entriesBefore) {
        throw new Error("Refusing to commit: wallet entries changed during the schema migration.");
      }

      await refreshCoinPurchaseSchemaSignature(client, previousCoinPurchaseSignature);
      const schemaSignature = await readFinancialFoundationSchemaSignature(client);
      await client.query(`
        CREATE TABLE "financial_foundation_schema_migrations" (
          "version" varchar(80) PRIMARY KEY,
          "schema_signature" text NOT NULL,
          "applied_at" timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(
        `INSERT INTO "financial_foundation_schema_migrations" ("version", "schema_signature")
         VALUES ($1, $2)`,
        [MIGRATION_VERSION, schemaSignature],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log("Financial foundation schema migration completed; existing wallet balances were unchanged.");
  } finally {
    client.release();
    await dbPool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Financial foundation migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
