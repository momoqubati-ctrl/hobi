#!/usr/bin/env node

import { config } from "dotenv";
import { createJiti } from "jiti";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setMigrationSafetyTimeouts } from "./migration-safety.mjs";

config();

const REQUIRED_DATABASE = "chat_app";
const REQUIRED_CONFIRMATION = "apply-to-chat_app";
const MIGRATION_VERSION = "coin-purchases-v1";
const PURCHASE_TABLES = [
  "wallet_agent_packages",
  "wallet_agent_inventory_orders",
  "member_coin_purchases",
];
const SIGNATURE_TABLES = [
  "wallet_balances",
  "wallet_operations",
  ...PURCHASE_TABLES,
];
const PURCHASE_INDEXES = [
  "wallet_operations_agent_idempotency_idx",
  "wallet_operations_agent_inventory_reference_idx",
  "wallet_operations_member_coin_purchase_reference_idx",
  "wallet_balances_agent_inventory_idx",
  "wallet_agent_packages_agent_amount_idx",
  "wallet_agent_packages_active_idx",
  "wallet_agent_inventory_orders_agent_idempotency_idx",
  "wallet_agent_inventory_orders_payment_reference_idx",
  "wallet_agent_inventory_orders_settlement_idx",
  "wallet_agent_inventory_orders_agent_status_idx",
  "wallet_agent_inventory_orders_receipt_expiry_idx",
  "member_coin_purchases_member_idempotency_idx",
  "member_coin_purchases_agent_payment_reference_idx",
  "member_coin_purchases_settlement_idx",
  "member_coin_purchases_member_status_idx",
  "member_coin_purchases_agent_status_idx",
  "member_coin_purchases_receipt_expiry_idx",
];
const PURCHASE_CONSTRAINTS = [
  "wallet_balances_agent_id_fkey",
  "wallet_operations_actor_agent_id_fkey",
  "wallet_balances_agent_inventory_nonnegative_check",
];
const PURCHASE_COLUMNS = [
  ["wallet_balances", "agent_id"],
  ["wallet_operations", "actor_agent_id"],
];

export async function readCoinPurchaseSchemaSignature(client) {
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
          'constraint' AS kind,
          relation.relname || '.' || constraint_info.conname AS object_name,
          jsonb_build_object(
            'type', constraint_info.contype,
            'definition', pg_get_constraintdef(constraint_info.oid, true),
            'validated', constraint_info.convalidated
          )::text AS definition
        FROM pg_constraint AS constraint_info
        JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY($1::text[])

        UNION ALL

        SELECT
          'index' AS kind,
          relation.relname || '.' || index_relation.relname AS object_name,
          jsonb_build_object(
            'definition', pg_get_indexdef(index_info.indexrelid),
            'valid', index_info.indisvalid,
            'ready', index_info.indisready,
            'live', index_info.indislive
          )::text AS definition
        FROM pg_index AS index_info
        JOIN pg_class AS relation ON relation.oid = index_info.indrelid
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        JOIN pg_class AS index_relation ON index_relation.oid = index_info.indexrelid
        WHERE namespace.nspname = 'public'
          AND relation.relname = ANY($1::text[])
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

export function assertCoinPurchaseSchemaSignatureMatches(actual, expected) {
  if (typeof expected !== "string" || actual !== expected) {
    throw new Error("Refusing to continue: the installed coin purchase schema has drifted.");
  }
}

const approvedOwnershipConstraintChanges = new Map([
  [
    "wallet_balances.wallet_balances_user_id_fkey",
    {
      canonicalName: "wallet_balances.wallet_balances_user_id_ownership_fk",
      definition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL",
      canonicalDefinition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
    },
  ],
  [
    "wallet_balances.wallet_balances_user_id_users_id_fk",
    {
      canonicalName: "wallet_balances.wallet_balances_user_id_ownership_fk",
      definition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
      canonicalDefinition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
    },
  ],
  [
    "wallet_operations.wallet_operations_actor_user_id_fkey",
    {
      canonicalName: "wallet_operations.wallet_operations_actor_user_id_ownership_fk",
      definition: "FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL",
      canonicalDefinition: "FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT",
    },
  ],
  [
    "wallet_operations.wallet_operations_actor_user_id_users_id_fk",
    {
      canonicalName: "wallet_operations.wallet_operations_actor_user_id_ownership_fk",
      definition: "FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT",
      canonicalDefinition: "FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT",
    },
  ],
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeCoinPurchaseSignature(signature) {
  const parsed = JSON.parse(signature);
  if (!Array.isArray(parsed)) {
    throw new Error("Refusing to continue: the installed coin purchase schema has drifted.");
  }

  return parsed.map((item) => {
    const normalized = { ...item };
    const definition = JSON.parse(item.definition);

    if (item.kind === "column" && typeof definition.default === "string") {
      definition.default = definition.default.replace(
        /^(?:public|pg_catalog)\.gen_random_uuid\(\)$/,
        "gen_random_uuid()",
      );
    }

    if (item.kind === "constraint") {
      const approvedChange = approvedOwnershipConstraintChanges.get(item.name);
      if (approvedChange) {
        if (
          definition.type !== "f" ||
          definition.validated !== true ||
          definition.definition !== approvedChange.definition
        ) {
          throw new Error("Refusing to continue: the installed coin purchase schema has drifted.");
        }
        normalized.name = approvedChange.canonicalName;
        definition.definition = approvedChange.canonicalDefinition;
      }
    }

    normalized.definition = stableJson(definition);
    return normalized;
  }).sort((left, right) =>
    `${left.kind}|${left.name}`.localeCompare(`${right.kind}|${right.name}`),
  );
}

export function assertCoinPurchaseSchemaSignatureUpgradeCompatible(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") {
    throw new Error("Refusing to continue: the installed coin purchase schema has drifted.");
  }
  if (actual === expected) return;

  try {
    if (
      stableJson(normalizeCoinPurchaseSignature(actual)) !==
      stableJson(normalizeCoinPurchaseSignature(expected))
    ) {
      throw new Error("Refusing to continue: the installed coin purchase schema has drifted.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("schema has drifted")) throw error;
    throw new Error("Refusing to continue: the installed coin purchase schema has drifted.");
  }
}

export function assertCoinPurchaseMigrationTarget(identity) {
  if (
    identity?.database_name !== REQUIRED_DATABASE ||
    identity?.public_schema_exists !== true
  ) {
    throw new Error("Refusing to migrate: expected the chat_app database and public schema.");
  }
}

export async function assertCoinPurchaseIndexesReady(client) {
  const result = await client.query(
    `
      SELECT required.name AS index_name
      FROM unnest($1::text[]) AS required(name)
      LEFT JOIN pg_namespace AS index_namespace ON index_namespace.nspname = 'public'
      LEFT JOIN pg_class AS index_relation
        ON index_relation.relname = required.name
       AND index_relation.relnamespace = index_namespace.oid
      LEFT JOIN pg_index AS index_info ON index_info.indexrelid = index_relation.oid
      WHERE index_relation.oid IS NULL
         OR NOT COALESCE(index_info.indisvalid, false)
         OR NOT COALESCE(index_info.indisready, false)
         OR NOT COALESCE(index_info.indislive, false)
      ORDER BY required.name
    `,
    [PURCHASE_INDEXES],
  );
  if (result.rows.length > 0) {
    const names = result.rows.map((row) => row.index_name);
    throw new Error(`Refusing to continue: purchase indexes are missing or invalid (${names.join(", ")}).`);
  }
}

export async function findPreExistingPurchaseObjects(client) {
  const result = await client.query(
    `
      SELECT 'table:' || required.name AS object_name
      FROM unnest($1::text[]) AS required(name)
      WHERE to_regclass('public.' || quote_ident(required.name)) IS NOT NULL

      UNION ALL

      SELECT 'column:' || required.table_name || '.' || required.column_name
      FROM unnest($2::text[], $3::text[]) AS required(table_name, column_name)
      JOIN information_schema.columns AS column_info
        ON column_info.table_schema = 'public'
       AND column_info.table_name = required.table_name
       AND column_info.column_name = required.column_name

      UNION ALL

      SELECT 'constraint:' || constraint_info.conname
      FROM pg_constraint AS constraint_info
      JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND constraint_info.conname = ANY($4::text[])

      UNION ALL

      SELECT 'index:' || index_info.indexname
      FROM pg_indexes AS index_info
      WHERE index_info.schemaname = 'public'
        AND index_info.indexname = ANY($5::text[])
      ORDER BY object_name
    `,
    [
      PURCHASE_TABLES,
      PURCHASE_COLUMNS.map(([tableName]) => tableName),
      PURCHASE_COLUMNS.map(([, columnName]) => columnName),
      PURCHASE_CONSTRAINTS,
      PURCHASE_INDEXES,
    ],
  );
  return result.rows.map((row) => row.object_name);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the coin purchase schema migration.");
  }
  if (process.env.COIN_PURCHASE_MIGRATION_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(`Set COIN_PURCHASE_MIGRATION_CONFIRM=${REQUIRED_CONFIRMATION} to confirm this migration.`);
  }

  const jiti = createJiti(import.meta.url);
  const { dbPool } = await jiti.import(join(process.cwd(), "server", "db", "index.ts"));
  const { ensureCoinPurchaseSchema } = await jiti.import(join(process.cwd(), "server", "db", "migrate.ts"));
  const client = await dbPool.connect();

  try {
    const identity = await client.query(
      `SELECT current_database() AS database_name, to_regnamespace('public') IS NOT NULL AS public_schema_exists`,
    );
    assertCoinPurchaseMigrationTarget(identity.rows[0]);

    const baseline = await client.query(`
      SELECT required.name AS missing_table
      FROM unnest(ARRAY[
        'users',
        'wallet_agents',
        'wallet_operations',
        'wallet_balances',
        'wallet_entries'
      ]) AS required(name)
      WHERE to_regclass('public.' || quote_ident(required.name)) IS NULL
    `);
    if (baseline.rows.length > 0) {
      throw new Error(`Refusing to migrate: required wallet baseline is missing (${baseline.rows.map((row) => row.missing_table).join(", ")}).`);
    }

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL search_path TO public, pg_catalog");
      await setMigrationSafetyTimeouts(client);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('hobi.coin-purchase-schema'), 1)",
      );

      const stateTable = await client.query(
        "SELECT to_regclass('public.coin_purchase_schema_migrations') AS table_name",
      );
      if (stateTable.rows[0]?.table_name) {
        const installed = await client.query(
          `SELECT "schema_signature" FROM "coin_purchase_schema_migrations" WHERE "version" = $1`,
          [MIGRATION_VERSION],
        );
        if (installed.rows.length !== 1) {
          throw new Error("Refusing to continue: migration state is missing or ambiguous.");
        }
        await assertCoinPurchaseIndexesReady(client);
        const currentSignature = await readCoinPurchaseSchemaSignature(client);
        assertCoinPurchaseSchemaSignatureMatches(
          currentSignature,
          installed.rows[0].schema_signature,
        );
        await client.query("COMMIT");
        console.log("Coin purchase schema is already installed and matches its recorded signature.");
        return;
      }

      const conflicts = await findPreExistingPurchaseObjects(client);
      if (conflicts.length > 0) {
        throw new Error(
          `Refusing to migrate: unexpected partial coin purchase schema (${conflicts.join(", ")}).`,
        );
      }

      const balancesBefore = await client.query(`
        SELECT COALESCE(jsonb_agg(snapshot ORDER BY account_type, bucket), '[]'::jsonb)::text AS snapshot
        FROM (
          SELECT "account_type", "bucket", COUNT(*)::text AS count,
                 COALESCE(SUM("balance_coins"), 0)::text AS total
          FROM "wallet_balances"
          GROUP BY "account_type", "bucket"
        ) snapshot
      `);

      await ensureCoinPurchaseSchema(client);
      const tables = await client.query(`
        SELECT required.name AS missing_table
        FROM unnest($1::text[]) AS required(name)
        WHERE to_regclass('public.' || quote_ident(required.name)) IS NULL
      `, [PURCHASE_TABLES]);
      const columns = await client.query(`
        SELECT required.table_name || '.' || required.column_name AS missing_column
        FROM unnest($1::text[], $2::text[]) AS required(table_name, column_name)
        WHERE NOT EXISTS (
          SELECT 1
          FROM information_schema.columns AS column_info
          WHERE column_info.table_schema = 'public'
            AND column_info.table_name = required.table_name
            AND column_info.column_name = required.column_name
        )
      `, [
        [...PURCHASE_COLUMNS.map(([tableName]) => tableName), ...PURCHASE_TABLES],
        [...PURCHASE_COLUMNS.map(([, columnName]) => columnName), ...PURCHASE_TABLES.map(() => "id")],
      ]);
      if (tables.rows.length > 0 || columns.rows.length > 0) {
        throw new Error("Coin purchase schema verification failed.");
      }
      await assertCoinPurchaseIndexesReady(client);

      const balancesAfter = await client.query(`
        SELECT COALESCE(jsonb_agg(snapshot ORDER BY account_type, bucket), '[]'::jsonb)::text AS snapshot
        FROM (
          SELECT "account_type", "bucket", COUNT(*)::text AS count,
                 COALESCE(SUM("balance_coins"), 0)::text AS total
          FROM "wallet_balances"
          GROUP BY "account_type", "bucket"
        ) snapshot
      `);
      if (balancesAfter.rows[0]?.snapshot !== balancesBefore.rows[0]?.snapshot) {
        throw new Error("Refusing to commit: wallet balances changed during the schema migration.");
      }

      const schemaSignature = await readCoinPurchaseSchemaSignature(client);
      await client.query(`
        CREATE TABLE "coin_purchase_schema_migrations" (
          "version" varchar(80) PRIMARY KEY,
          "schema_signature" text NOT NULL,
          "applied_at" timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(
        `INSERT INTO "coin_purchase_schema_migrations" ("version", "schema_signature") VALUES ($1, $2)`,
        [MIGRATION_VERSION, schemaSignature],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    console.log("Coin purchase schema migration completed for chat_app; existing wallet balances were unchanged.");
  } finally {
    client.release();
    await dbPool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Coin purchase schema migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
