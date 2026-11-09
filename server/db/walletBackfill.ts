import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const LEGACY_WALLET_OPENING_KEY = "legacy-opening-v1";

const MIGRATION_LOCK_NAMESPACE = 1_465_000_012;
const MIGRATION_LOCK_ID = 1;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const LEGACY_OPENING_FINGERPRINT = createHash("sha256").update(LEGACY_WALLET_OPENING_KEY).digest("hex");

export type LegacyWalletBackfillResult = {
  alreadyApplied: boolean;
  totalCoins: string | null;
};

export async function runLegacyWalletBackfill(client: PoolClient): Promise<LegacyWalletBackfillResult> {
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_ID,
    ]);
    await client.query(`LOCK TABLE "user_profiles" IN SHARE ROW EXCLUSIVE MODE`);

    const openingOperation = await client.query<{ id: string }>(
      `SELECT "id"
       FROM "wallet_operations"
       WHERE "actor_scope" = 'system'
         AND "operation_type" = 'legacy_opening'
         AND "idempotency_key" = $1
       FOR UPDATE`,
      [LEGACY_WALLET_OPENING_KEY],
    );

    if (openingOperation.rows.length > 0) {
      await client.query("COMMIT");
      transactionStarted = false;
      return { alreadyApplied: true, totalCoins: null };
    }

    const existingWalletData = await client.query<{ wallet_data_exists: boolean }>(
      `SELECT (
         EXISTS (SELECT 1 FROM "wallet_operations")
         OR EXISTS (SELECT 1 FROM "wallet_entries")
         OR EXISTS (SELECT 1 FROM "wallet_balances" WHERE "balance_coins" <> 0)
       ) AS "wallet_data_exists"`,
    );
    if (existingWalletData.rows[0]?.wallet_data_exists) {
      throw new Error("wallet data exists without the legacy opening marker; manual review is required");
    }

    const negativeBalances = await client.query<{ negative_count: string }>(
      `SELECT count(*)::text AS "negative_count"
       FROM "user_profiles"
       WHERE COALESCE("coins", 0) < 0`,
    );
    if (BigInt(negativeBalances.rows[0]?.negative_count ?? "0") > 0n) {
      throw new Error("negative legacy coin balance prevents wallet cutover");
    }

    const totalResult = await client.query<{ legacy_coin_total: string }>(
      `SELECT COALESCE(sum(COALESCE("coins", 0)::numeric), 0)::text AS "legacy_coin_total"
       FROM "user_profiles"`,
    );
    const totalCoins = BigInt(totalResult.rows[0]?.legacy_coin_total ?? "0");
    if (totalCoins > MAX_POSTGRES_BIGINT) {
      throw new Error("legacy coin total exceeds the wallet ledger's supported range");
    }

    const operationResult = await client.query<{ id: string }>(
      `INSERT INTO "wallet_operations"
        ("actor_scope", "operation_type", "idempotency_key", "request_fingerprint")
       VALUES ('system', 'legacy_opening', $1, $2)
       RETURNING "id"`,
      [LEGACY_WALLET_OPENING_KEY, LEGACY_OPENING_FINGERPRINT],
    );
    const operationId = operationResult.rows[0]?.id;
    if (!operationId) {
      throw new Error("wallet opening operation was not created");
    }

    await client.query(
      `INSERT INTO "wallet_balances" ("account_type", "bucket", "balance_coins")
       VALUES ('system', 'legacy_opening_equity', 0)
       ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO "wallet_balances" ("account_type", "user_id", "bucket", "balance_coins")
       SELECT 'member', "user_id", 'legacy_spendable', 0
       FROM "user_profiles"
       ON CONFLICT DO NOTHING`,
    );

    const openingEquity = await client.query<{ id: string }>(
      `SELECT "id"
       FROM "wallet_balances"
       WHERE "account_type" = 'system' AND "bucket" = 'legacy_opening_equity'
       FOR UPDATE`,
    );
    const equityAccountId = openingEquity.rows[0]?.id;
    if (!equityAccountId) {
      throw new Error("wallet opening equity account was not created");
    }

    await client.query(
      `UPDATE "wallet_balances" AS balance
       SET "balance_coins" = COALESCE(profile."coins", 0)::bigint,
           "updated_at" = now()
       FROM "user_profiles" AS profile
       WHERE balance."account_type" = 'member'
         AND balance."bucket" = 'legacy_spendable'
         AND balance."user_id" = profile."user_id"`,
    );
    await client.query(
      `UPDATE "wallet_balances"
       SET "balance_coins" = $1::bigint * -1,
           "updated_at" = now()
       WHERE "id" = $2`,
      [totalCoins.toString(), equityAccountId],
    );

    await client.query(
      `INSERT INTO "wallet_entries" ("operation_id", "wallet_balance_id", "amount")
       SELECT $1, balance."id", profile."coins"::bigint
       FROM "user_profiles" AS profile
       JOIN "wallet_balances" AS balance
         ON balance."account_type" = 'member'
        AND balance."bucket" = 'legacy_spendable'
        AND balance."user_id" = profile."user_id"
       WHERE COALESCE(profile."coins", 0) > 0`,
      [operationId],
    );
    if (totalCoins > 0n) {
      await client.query(
        `INSERT INTO "wallet_entries" ("operation_id", "wallet_balance_id", "amount")
         VALUES ($1, $2, $3::bigint * -1)`,
        [operationId, equityAccountId, totalCoins.toString()],
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return { alreadyApplied: false, totalCoins: totalCoins.toString() };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "wallet opening migration failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  }
}
