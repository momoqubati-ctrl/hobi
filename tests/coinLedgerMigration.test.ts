import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { ensureWalletLedgerSchema } from "../server/db/migrate";
import { runLegacyWalletBackfill } from "../server/db/walletBackfill";

type FakeOptions = {
  operationExists?: boolean;
  negativeProfileCount?: string;
  totalCoins?: string;
  failOn?: string;
};

function createFakeClient(options: FakeOptions = {}) {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      if (options.failOn && text.includes(options.failOn)) {
        throw new Error("simulated database failure");
      }

      if (text.includes('FROM "wallet_operations"') && text.includes("FOR UPDATE")) {
        return { rows: options.operationExists ? [{ id: "opening-operation" }] : [] };
      }
      if (text.includes('AS "negative_count"')) {
        return { rows: [{ negative_count: options.negativeProfileCount ?? "0" }] };
      }
      if (text.includes('INSERT INTO "wallet_operations"')) {
        return { rows: [{ id: "opening-operation" }] };
      }
      if (text.includes('AS "legacy_coin_total"')) {
        return { rows: [{ legacy_coin_total: options.totalCoins ?? "0" }] };
      }
      if (text.includes("legacy_opening_equity")) {
        return { rows: [{ id: "opening-equity-account" }] };
      }
      if (text.includes("wallet_data_exists")) {
        return { rows: [{ exists: false }] };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;

  return { client, statements };
}

test("wallet schema migration creates isolated commission settings storage", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await ensureWalletLedgerSchema(client);

  assert.ok(statements[0].includes('CREATE TABLE IF NOT EXISTS "wallet_agents"'));
  assert.ok(statements.some((statement) =>
    statement.includes('ALTER TABLE "wallet_agents"') &&
    statement.includes('ADD COLUMN IF NOT EXISTS "phone"'),
  ));
  assert.ok(statements.some((statement) => statement.includes("'site_inventory'")));
  assert.ok(statements.some((statement) =>
    statement.includes("wallet_balances_site_inventory_nonnegative_check"),
  ));
  assert.ok(statements.some((statement) =>
    statement.includes("wallet_operations_site_funding_reference_idx"),
  ));
  assert.ok(statements.some((statement) =>
    statement.includes('INSERT INTO "wallet_balances"') &&
    statement.includes("('system', NULL, 'site_inventory', 0)") &&
    statement.includes("('system', NULL, 'external_clearing', 0)") &&
    statement.includes("DO NOTHING"),
  ));
  assert.ok(statements[0].includes('CREATE TABLE IF NOT EXISTS "wallet_settings"'));
  assert.ok(statements[0].includes('"metadata" jsonb DEFAULT \'{}\'::jsonb NOT NULL'));
  assert.ok(statements[0].includes('"updated_by" varchar(255)'));
});

test("wallet schema migration adds metadata to an existing operations table", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await ensureWalletLedgerSchema(client);

  assert.ok(statements.some((statement) =>
    statement.includes('ALTER TABLE "wallet_operations"') &&
    statement.includes('ADD COLUMN IF NOT EXISTS "metadata" jsonb') &&
    statement.includes("DEFAULT '{}'::jsonb") &&
    statement.includes("NOT NULL"),
  ));
});

test("legacy opening commits its marker and balances in one transaction", async () => {
  const { client, statements } = createFakeClient({ totalCoins: "47" });

  const result = await runLegacyWalletBackfill(client);

  assert.equal(result.alreadyApplied, false);
  assert.ok(statements.indexOf("BEGIN") < statements.findIndex((sql) => sql.includes("LOCK TABLE")));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO "wallet_operations"')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO "wallet_entries"')));
  assert.equal(statements.at(-1), "COMMIT");
  assert.equal(statements.includes("ROLLBACK"), false);
});

test("replaying the opening migration does not add another opening entry", async () => {
  const { client, statements } = createFakeClient({ operationExists: true });

  const result = await runLegacyWalletBackfill(client);

  assert.equal(result.alreadyApplied, true);
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO "wallet_entries"')), false);
  assert.equal(statements.at(-1), "COMMIT");
});

test("negative legacy balances abort the opening transaction", async () => {
  const { client, statements } = createFakeClient({ negativeProfileCount: "1" });

  await assert.rejects(runLegacyWalletBackfill(client), /negative legacy coin balance/i);

  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});

test("a failure after inserting the opening marker rolls back the entire cutover", async () => {
  const { client, statements } = createFakeClient({
    totalCoins: "47",
    failOn: 'INSERT INTO "wallet_entries"',
  });

  await assert.rejects(runLegacyWalletBackfill(client), /simulated database failure/);

  assert.equal(statements.some((sql) => sql.includes('INSERT INTO "wallet_operations"')), true);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});
