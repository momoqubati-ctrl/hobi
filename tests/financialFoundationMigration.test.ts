import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertFinancialFoundationBaseline,
  assertFinancialFoundationMigrationTarget,
  assertFinancialFoundationSchemaSignatureMatches,
  prepareCoinPurchaseSchemaSignatureUpgrade,
  refreshCoinPurchaseSchemaSignature,
  readFinancialFoundationWalletBalanceSnapshot,
  readFinancialFoundationWalletEntrySnapshot,
} from "../scripts/migrate-financial-foundation-closeout.mjs";
import {
  assertCoinPurchaseSchemaSignatureUpgradeCompatible,
} from "../scripts/migrate-coin-purchases.mjs";
import { setMigrationSafetyTimeouts } from "../scripts/migration-safety.mjs";

test("financial foundation migration requires its explicit database target", () => {
  assert.doesNotThrow(() =>
    assertFinancialFoundationMigrationTarget({
      database_name: "chat_app",
      public_schema_exists: true,
    }),
  );
  assert.throws(
    () =>
      assertFinancialFoundationMigrationTarget({
        database_name: "other_database",
        public_schema_exists: true,
      }),
    /expected the chat_app database and public schema/,
  );
});

test("financial foundation migration refuses incomplete wallet ownership references", async () => {
  const missingBaselineClient = {
    async query() {
      return { rows: [{ object_name: "wallet_operations.actor_agent_id" }] };
    },
  };
  await assert.rejects(
    () => assertFinancialFoundationBaseline(missingBaselineClient),
    /wallet ledger baseline is incomplete/,
  );

  const completeBaselineClient = {
    async query() {
      return { rows: [] };
    },
  };
  await assert.doesNotReject(() => assertFinancialFoundationBaseline(completeBaselineClient));
});

test("financial foundation migration signature rejects missing or drifted state", () => {
  assert.doesNotThrow(() =>
    assertFinancialFoundationSchemaSignatureMatches("signature-v1", "signature-v1"),
  );
  assert.throws(
    () => assertFinancialFoundationSchemaSignatureMatches("signature-v2", "signature-v1"),
    /schema has drifted/,
  );
  assert.throws(
    () => assertFinancialFoundationSchemaSignatureMatches("signature-v1", undefined),
    /schema has drifted/,
  );
});

test("wallet balance snapshot preserves every account identity and balance", async () => {
  const accounts = [
    {
      id: "account-a",
      account_type: "member",
      user_id: "member-a",
      agent_id: null,
      bucket: "legacy_spendable",
      balance_coins: "10",
    },
    {
      id: "account-b",
      account_type: "member",
      user_id: "member-b",
      agent_id: null,
      bucket: "legacy_spendable",
      balance_coins: "20",
    },
  ];
  const client = {
    async query() {
      return { rows: accounts };
    },
  };

  const snapshot = await readFinancialFoundationWalletBalanceSnapshot(client);

  assert.deepEqual(JSON.parse(snapshot), accounts);
});

test("wallet entry snapshot preserves ledger entry identities and amounts", async () => {
  const entries = [
    {
      id: "entry-1",
      operation_id: "operation-1",
      wallet_balance_id: "account-1",
      amount: "-10",
      reversal_of_entry_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  const client = {
    async query() {
      return { rows: entries };
    },
  };

  const snapshot = await readFinancialFoundationWalletEntrySnapshot(client);

  assert.deepEqual(JSON.parse(snapshot), entries);
});

test("coin purchase signature upgrade accepts only known wallet ownership and UUID default changes", () => {
  const recorded = JSON.stringify([
    {
      kind: "constraint",
      name: "wallet_balances.wallet_balances_user_id_fkey",
      definition: JSON.stringify({
        type: "f",
        validated: true,
        definition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL",
      }),
    },
    {
      kind: "column",
      name: "wallet_balances.id",
      definition: JSON.stringify({ default: "pg_catalog.gen_random_uuid()" }),
    },
  ]);
  const current = JSON.stringify([
    {
      kind: "constraint",
      name: "wallet_balances.wallet_balances_user_id_users_id_fk",
      definition: JSON.stringify({
        type: "f",
        validated: true,
        definition: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
      }),
    },
    {
      kind: "column",
      name: "wallet_balances.id",
      definition: JSON.stringify({ default: "gen_random_uuid()" }),
    },
  ]);

  assert.doesNotThrow(() =>
    assertCoinPurchaseSchemaSignatureUpgradeCompatible(current, recorded),
  );
  assert.throws(
    () => assertCoinPurchaseSchemaSignatureUpgradeCompatible(current, "[]"),
    /schema has drifted/,
  );
});

test("financial foundation migration validates then refreshes an installed coin purchase signature", async () => {
  const statements: string[] = [];
  let signatureCalls = 0;
  const client = {
    async query(statement: string) {
      statements.push(statement);
      if (statement.includes("to_regclass")) {
        return { rows: [{ table_name: "coin_purchase_schema_migrations" }] };
      }
      if (statement.includes("SELECT \"schema_signature\"")) {
        return { rows: [{ schema_signature: "before" }] };
      }
      if (statement.includes("WITH schema_objects")) {
        signatureCalls += 1;
        const signature = signatureCalls === 1 ? "before" : "after";
        return { rows: [{ signature }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const installedSignature = await prepareCoinPurchaseSchemaSignatureUpgrade(client);
  assert.equal(installedSignature, "before");
  await refreshCoinPurchaseSchemaSignature(client, installedSignature);

  assert.ok(statements.some((statement) =>
    statement.includes('UPDATE "coin_purchase_schema_migrations"') &&
    statement.includes('"schema_signature" = $2'),
  ));
});

test("financial foundation migration refuses to bless an already drifted coin purchase schema", async () => {
  const client = {
    async query(statement: string) {
      if (statement.includes("to_regclass")) {
        return { rows: [{ table_name: "coin_purchase_schema_migrations" }] };
      }
      if (statement.includes("SELECT \"schema_signature\"")) {
        return { rows: [{ schema_signature: "recorded" }] };
      }
      return { rows: [{ signature: "drifted" }] };
    },
  };

  await assert.rejects(
    () => prepareCoinPurchaseSchemaSignatureUpgrade(client),
    /coin purchase schema has drifted/,
  );
});

test("migration safety sets bounded lock and statement timeouts within the transaction", async () => {
  const statements: string[] = [];
  const client = {
    async query(statement: string) {
      statements.push(statement);
    },
  };

  await setMigrationSafetyTimeouts(client);

  assert.deepEqual(statements, [
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '10min'",
  ]);
});
