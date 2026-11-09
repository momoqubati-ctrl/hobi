import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  fundSiteWallet,
  SiteWalletFundingError,
} from "../server/services/siteWalletFundingService";
import type {
  SiteWalletFundingInput,
  SiteWalletFundingPersistence,
} from "../server/services/siteWalletFundingService";

const validInput: SiteWalletFundingInput = {
  hostingOwnerUsername: "site-host",
  amountCoins: 250,
  externalReference: "Transfer-ABC-123",
  idempotencyKey: "funding-attempt-1",
};

const fingerprintFor = (input: SiteWalletFundingInput) =>
  createHash("sha256")
    .update(JSON.stringify({
      operationType: "site_wallet_funding",
      hostingOwnerUsername: input.hostingOwnerUsername.trim().toLowerCase(),
      amountCoins: input.amountCoins,
      externalReference: input.externalReference.trim().toLowerCase(),
    }))
    .digest("hex");

function createFundingPersistence(options: {
  accounts?: Array<{ id: string; bucket: string; balance_coins: string }>;
  existingOperation?: Record<string, unknown>;
  duplicateReference?: boolean;
  failOn?: string;
} = {}) {
  const statements: string[] = [];
  const entries: Array<{ walletBalanceId: string; amount: string }> = [];
  const accounts = options.accounts ?? [
    { id: "site-inventory", bucket: "site_inventory", balance_coins: "500" },
    { id: "external-clearing", bucket: "external_clearing", balance_coins: "-500" },
  ];
  let insertedOperation: Record<string, unknown> | undefined;
  const client = {
    async query(text: string, values: unknown[] = []) {
      statements.push(text);
      if (options.failOn && text.includes(options.failOn)) {
        throw new Error("simulated funding persistence failure");
      }

      if (text.includes('FROM "wallet_operations"') && text.includes('"idempotency_key"')) {
        return { rows: options.existingOperation ? [options.existingOperation] : [] };
      }
      if (text.includes('FROM "wallet_balances"') && text.includes("FOR UPDATE")) {
        return {
          rows: accounts.map((account) => ({ ...account, account_type: "system", user_id: null })),
        };
      }
      if (text.includes('INSERT INTO "wallet_operations"')) {
        if (options.duplicateReference) return { rows: [] };
        insertedOperation = {
          id: "funding-operation-1",
          operation_type: values[0],
          request_fingerprint: values[2],
          reference_id: values[4],
          metadata: JSON.parse(String(values[5])),
          created_at: new Date("2026-10-31T12:00:00.000Z"),
        };
        return { rows: [{ id: insertedOperation.id, created_at: insertedOperation.created_at }] };
      }
      if (text.includes('UPDATE "wallet_balances"')) {
        const account = accounts.find((item) => item.id === values[1]);
        assert.ok(account);
        account.balance_coins = String(BigInt(account.balance_coins) + BigInt(String(values[0])));
        return { rows: [{ id: account.id, balance_coins: account.balance_coins }] };
      }
      if (text.includes('INSERT INTO "wallet_entries"')) {
        entries.push({ walletBalanceId: String(values[1]), amount: String(values[2]) });
        return { rows: [] };
      }
      if (text.includes('SELECT "id"') && text.includes('"reference_type"')) {
        return { rows: options.duplicateReference ? [{ id: "prior-funding" }] : [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const persistence: SiteWalletFundingPersistence = {
    connect: async () => client as unknown as import("pg").PoolClient,
  };
  return { persistence, statements, entries, accounts, getInsertedOperation: () => insertedOperation };
}

test("site-wallet funding rejects invalid amounts and references before connecting", async () => {
  let connected = false;
  const persistence: SiteWalletFundingPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };

  for (const input of [
    { ...validInput, amountCoins: 0 },
    { ...validInput, amountCoins: 1.5 },
    { ...validInput, amountCoins: Number.MAX_SAFE_INTEGER + 1 },
    { ...validInput, externalReference: "   " },
    { ...validInput, externalReference: "ref\nvalue" },
    { ...validInput, idempotencyKey: "" },
  ]) {
    await assert.rejects(fundSiteWallet(input, persistence), { code: "INVALID_FUNDING" });
  }
  assert.equal(connected, false);
});

test("site-wallet funding records balanced entries and commits with owner attribution", async () => {
  const fake = createFundingPersistence();

  const result = await fundSiteWallet(validInput, fake.persistence);

  assert.deepEqual(fake.entries, [
    { walletBalanceId: "site-inventory", amount: "250" },
    { walletBalanceId: "external-clearing", amount: "-250" },
  ]);
  assert.equal(fake.accounts[0].balance_coins, "750");
  assert.equal(fake.accounts[1].balance_coins, "-750");
  assert.equal(fake.entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n), 0n);
  assert.equal(fake.getInsertedOperation()?.metadata && (fake.getInsertedOperation()?.metadata as Record<string, unknown>).hostingOwnerUsername, "site-host");
  assert.equal(fake.getInsertedOperation()?.reference_id, "transfer-abc-123");
  assert.equal(result.amountCoins, 250);
  assert.equal(result.externalReference, "transfer-abc-123");
  assert.equal(result.siteWalletBalance, "750");
  assert.equal(result.replayed, false);
  assert.equal(fake.statements.at(-1), "COMMIT");
  assert.equal(fake.statements.includes("ROLLBACK"), false);
});

test("same idempotency key and payload replays the original result without another posting", async () => {
  const fingerprint = fingerprintFor(validInput);
  const fake = createFundingPersistence({
    existingOperation: {
      id: "funding-operation-existing",
      operation_type: "site_wallet_funding",
      request_fingerprint: fingerprint,
      reference_id: "transfer-abc-123",
      metadata: { amountCoins: "250", siteWalletBalanceAfter: "750" },
      created_at: new Date("2026-10-31T12:00:00.000Z"),
    },
  });

  const result = await fundSiteWallet(validInput, fake.persistence);

  assert.equal(result.id, "funding-operation-existing");
  assert.equal(result.siteWalletBalance, "750");
  assert.equal(result.replayed, true);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.statements.some((statement) => statement.includes('INSERT INTO "wallet_operations"')), false);
  assert.equal(fake.statements.at(-1), "COMMIT");
});

test("same idempotency key with a different payload is rejected", async () => {
  const fake = createFundingPersistence({
    existingOperation: {
      id: "funding-operation-existing",
      operation_type: "site_wallet_funding",
      request_fingerprint: fingerprintFor(validInput),
      reference_id: "transfer-abc-123",
      metadata: { amountCoins: "250", siteWalletBalanceAfter: "750" },
      created_at: new Date("2026-10-31T12:00:00.000Z"),
    },
  });

  await assert.rejects(
    fundSiteWallet({ ...validInput, amountCoins: 300 }, fake.persistence),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("missing site inventory or external clearing accounts fail closed", async () => {
  const fake = createFundingPersistence({
    accounts: [{ id: "site-inventory", bucket: "site_inventory", balance_coins: "0" }],
  });

  await assert.rejects(fundSiteWallet(validInput, fake.persistence), {
    code: "LEDGER_ACCOUNT_NOT_INITIALIZED",
  });
  assert.equal(fake.statements.some((statement) => statement.includes('INSERT INTO "wallet_operations"')), false);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("funding rejects a balance that would exceed PostgreSQL bigint capacity", async () => {
  const fake = createFundingPersistence({
    accounts: [
      { id: "site-inventory", bucket: "site_inventory", balance_coins: "9223372036854775807" },
      { id: "external-clearing", bucket: "external_clearing", balance_coins: "-500" },
    ],
  });

  await assert.rejects(fundSiteWallet(validInput, fake.persistence), { code: "BALANCE_OVERFLOW" });
  assert.equal(fake.statements.some((statement) => statement.includes('INSERT INTO "wallet_operations"')), false);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("duplicate external references conflict even when the idempotency key differs", async () => {
  const fake = createFundingPersistence({ duplicateReference: true });

  await assert.rejects(fundSiteWallet({ ...validInput, idempotencyKey: "different-key" }, fake.persistence), {
    code: "DUPLICATE_EXTERNAL_REFERENCE",
  });
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("a posting failure rolls back the operation and both balance entries", async () => {
  const fake = createFundingPersistence({ failOn: 'INSERT INTO "wallet_entries"' });

  await assert.rejects(fundSiteWallet(validInput, fake.persistence), /simulated funding persistence failure/);

  assert.equal(fake.statements.at(-1), "ROLLBACK");
  assert.equal(fake.statements.includes("COMMIT"), false);
});
