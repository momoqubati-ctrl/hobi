import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  postWalletOperation,
  WalletPostingError,
  type WalletPostingPersistence,
} from "../server/services/walletPostingService";
import type { PoolClient } from "pg";

const EARNINGS_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const PURCHASED_ACCOUNT_ID = "b0000000-0000-4000-8000-000000000002";

const makePosting = (accountId: string, amount: bigint) => ({
  walletBalanceId: accountId,
  amount,
});

function createPersistence(options: {
  balances?: Record<string, string>;
  accountOwners?: Record<string, string>;
  accountTypes?: Record<string, "member" | "site_owner" | "agent" | "system">;
  accountBuckets?: Record<string, string>;
  failOnEntryNumber?: number;
  existingOperation?: {
    id: string;
    operation_type: string;
    request_fingerprint: string;
    reference_type: string | null;
    reference_id: string | null;
  };
} = {}) {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const balances = new Map(Object.entries(options.balances ?? {}));
  const entries: bigint[] = [];
  let entryInsertCount = 0;
  let balancesAtTransactionStart = new Map<string, string>();
  let entriesAtTransactionStart = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push({ text, values });
      if (text === "BEGIN") {
        balancesAtTransactionStart = new Map(balances);
        entriesAtTransactionStart = entries.length;
      }
      if (text === "ROLLBACK") {
        balances.clear();
        for (const [id, balance] of balancesAtTransactionStart) balances.set(id, balance);
        entries.length = entriesAtTransactionStart;
      }
      if (text.includes('FROM "wallet_operations"') && text.includes("FOR UPDATE")) {
        return { rows: options.existingOperation ? [options.existingOperation] : [] };
      }
      if (text.includes('FROM "wallet_balances"') && text.includes("FOR UPDATE")) {
        const ids = values?.[0] as string[];
        return {
          rows: ids.map((id) => ({
            id,
            account_type: options.accountTypes?.[id] ?? "member",
            user_id: options.accountOwners?.[id] ?? null,
            agent_id: null,
            bucket: options.accountBuckets?.[id] ??
              (id === EARNINGS_ACCOUNT_ID ? "gift_earnings_spendable" : "purchased_spendable"),
            balance_coins: balances.get(id) ?? "0",
          })),
        };
      }
      if (text.includes('UPDATE "wallet_balances"')) {
        const amount = BigInt(String(values?.[0]));
        const accountId = String(values?.[1]);
        const next = BigInt(balances.get(accountId) ?? "0") + amount;
        if (next < 0n) return { rows: [] };
        balances.set(accountId, next.toString());
        return { rows: [{ id: accountId }] };
      }
      if (text.includes('INSERT INTO "wallet_operations"')) {
        return { rows: [{ id: "operation-1" }] };
      }
      if (text.includes('INSERT INTO "wallet_entries"')) {
        entryInsertCount += 1;
        if (entryInsertCount === options.failOnEntryNumber) {
          throw new Error("simulated wallet entry failure");
        }
        entries.push(BigInt(String(values?.[2])));
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const persistence: WalletPostingPersistence = {
    connect: async () => client,
  };
  return { persistence, statements, balances, entries };
}

const baseInput = {
  actorScope: "system" as const,
  operationType: "internal_transfer",
  idempotencyKey: "transfer-001",
  referenceType: "transfer",
  referenceId: "request-001",
  postings: [makePosting(EARNINGS_ACCOUNT_ID, -10n), makePosting(PURCHASED_ACCOUNT_ID, 10n)],
};

test("wallet posting rejects unbalanced operations before opening a transaction", async () => {
  let connected = false;
  const persistence: WalletPostingPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("unexpected connection");
    },
  };

  await assert.rejects(
    postWalletOperation(
      { ...baseInput, postings: [makePosting(EARNINGS_ACCOUNT_ID, -10n), makePosting(PURCHASED_ACCOUNT_ID, 9n)] },
      persistence,
    ),
    (error: unknown) => error instanceof WalletPostingError && error.code === "UNBALANCED_OPERATION",
  );
  assert.equal(connected, false);
});

test("wallet posting rejects duplicate account lines before opening a transaction", async () => {
  let connected = false;
  const persistence: WalletPostingPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("unexpected connection");
    },
  };

  await assert.rejects(
    postWalletOperation(
      {
        ...baseInput,
        postings: [
          makePosting(EARNINGS_ACCOUNT_ID.toUpperCase(), -10n),
          makePosting(EARNINGS_ACCOUNT_ID, 10n),
        ],
      },
      persistence,
    ),
    (error: unknown) => error instanceof WalletPostingError && error.code === "DUPLICATE_ACCOUNT",
  );
  assert.equal(connected, false);
});

test("wallet posting updates balances and writes balanced entries atomically", async () => {
  const { persistence, statements, balances, entries } = createPersistence({
    balances: { [EARNINGS_ACCOUNT_ID]: "30", [PURCHASED_ACCOUNT_ID]: "5" },
  });

  const result = await postWalletOperation(baseInput, persistence);

  assert.equal(result.replayed, false);
  assert.equal(balances.get(EARNINGS_ACCOUNT_ID), "20");
  assert.equal(balances.get(PURCHASED_ACCOUNT_ID), "15");
  assert.deepEqual(entries, [-10n, 10n]);
  assert.equal(entries.reduce((sum, amount) => sum + amount, 0n), 0n);
  assert.equal(statements.at(-1)?.text, "COMMIT");
});

test("wallet posting rolls back when a restricted account would become negative", async () => {
  const { persistence, statements, entries } = createPersistence({
    balances: { [EARNINGS_ACCOUNT_ID]: "9", [PURCHASED_ACCOUNT_ID]: "5" },
  });

  await assert.rejects(
    postWalletOperation(baseInput, persistence),
    (error: unknown) => error instanceof WalletPostingError && error.code === "INSUFFICIENT_FUNDS",
  );
  assert.equal(entries.length, 0);
  assert.equal(statements.at(-1)?.text, "ROLLBACK");
});

test("system fee accounts cannot become negative", async () => {
  const { persistence, statements } = createPersistence({
    balances: { [EARNINGS_ACCOUNT_ID]: "1", [PURCHASED_ACCOUNT_ID]: "0" },
    accountTypes: {
      [EARNINGS_ACCOUNT_ID]: "system",
      [PURCHASED_ACCOUNT_ID]: "system",
    },
    accountBuckets: {
      [EARNINGS_ACCOUNT_ID]: "platform_fee",
      [PURCHASED_ACCOUNT_ID]: "external_clearing",
    },
  });

  await assert.rejects(
    postWalletOperation(baseInput, persistence),
    (error: unknown) => error instanceof WalletPostingError && error.code === "INSUFFICIENT_FUNDS",
  );
  assert.equal(statements.at(-1)?.text, "ROLLBACK");
});

test("wallet posting rolls back prior balance and entry writes when a later insert fails", async () => {
  const { persistence, statements, balances, entries } = createPersistence({
    balances: { [EARNINGS_ACCOUNT_ID]: "30", [PURCHASED_ACCOUNT_ID]: "5" },
    failOnEntryNumber: 2,
  });

  await assert.rejects(postWalletOperation(baseInput, persistence), /simulated wallet entry failure/);

  assert.equal(balances.get(EARNINGS_ACCOUNT_ID), "30");
  assert.equal(balances.get(PURCHASED_ACCOUNT_ID), "5");
  assert.deepEqual(entries, []);
  assert.equal(statements.at(-1)?.text, "ROLLBACK");
});

test("member operations cannot post against another member's wallet", async () => {
  const { persistence, statements } = createPersistence({
    balances: { [EARNINGS_ACCOUNT_ID]: "30", [PURCHASED_ACCOUNT_ID]: "5" },
    accountOwners: { [EARNINGS_ACCOUNT_ID]: "member-a", [PURCHASED_ACCOUNT_ID]: "member-b" },
  });

  await assert.rejects(
    postWalletOperation(
      { ...baseInput, actorScope: "member", actorUserId: "member-a" },
      persistence,
    ),
    (error: unknown) => error instanceof WalletPostingError && error.code === "ACTOR_ACCOUNT_MISMATCH",
  );
  assert.equal(statements.at(-1)?.text, "ROLLBACK");
});

test("member operations cannot post against an agent inventory account", async () => {
  const { persistence, statements } = createPersistence({
    balances: { [EARNINGS_ACCOUNT_ID]: "30", [PURCHASED_ACCOUNT_ID]: "5" },
    accountOwners: { [EARNINGS_ACCOUNT_ID]: "member-a" },
    accountTypes: { [PURCHASED_ACCOUNT_ID]: "agent" },
  });

  test("site owners can post only against their own site-owner wallets and system accounts", async () => {
    const siteOwnerAccountId = "c0000000-0000-4000-8000-000000000003";
    const fake = createPersistence({
      balances: {
        [siteOwnerAccountId]: "50",
        [PURCHASED_ACCOUNT_ID]: "0",
      },
      accountOwners: { [siteOwnerAccountId]: "owner-a" },
      accountTypes: {
        [siteOwnerAccountId]: "site_owner",
        [PURCHASED_ACCOUNT_ID]: "system",
      },
    });

    const result = await postWalletOperation({
      actorScope: "site_owner",
      actorUserId: "owner-a",
      operationType: "site_owner_transfer",
      idempotencyKey: "site-owner-transfer",
      postings: [
        makePosting(siteOwnerAccountId, -10n),
        makePosting(PURCHASED_ACCOUNT_ID, 10n),
      ],
    }, fake.persistence);

    assert.equal(result.replayed, false);
    assert.equal(fake.balances.get(siteOwnerAccountId), "40");
    assert.equal(fake.balances.get(PURCHASED_ACCOUNT_ID), "10");
  });

  test("site owners cannot post against a different site owner's wallet", async () => {
    const siteOwnerAccountId = "c0000000-0000-4000-8000-000000000003";
    const fake = createPersistence({
      accountOwners: { [siteOwnerAccountId]: "owner-b" },
      accountTypes: { [siteOwnerAccountId]: "site_owner" },
    });

    await assert.rejects(
      postWalletOperation({
        actorScope: "site_owner",
        actorUserId: "owner-a",
        operationType: "site_owner_transfer",
        idempotencyKey: "site-owner-transfer",
        postings: [
          makePosting(siteOwnerAccountId, -10n),
          makePosting(PURCHASED_ACCOUNT_ID, 10n),
        ],
      }, fake.persistence),
      (error: unknown) => error instanceof WalletPostingError && error.code === "ACTOR_ACCOUNT_MISMATCH",
    );
  });

  await assert.rejects(
    postWalletOperation(
      { ...baseInput, actorScope: "member", actorUserId: "member-a" },
      persistence,
    ),
    (error: unknown) => error instanceof WalletPostingError && error.code === "ACTOR_ACCOUNT_MISMATCH",
  );
  assert.equal(statements.at(-1)?.text, "ROLLBACK");
});

test("wallet posting replays a matching idempotency key without adding entries", async () => {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      operationType: baseInput.operationType,
      actorScope: baseInput.actorScope,
      actorUserId: null,
      actorAgentId: null,
      referenceType: baseInput.referenceType,
      referenceId: baseInput.referenceId,
      postings: [
        { walletBalanceId: EARNINGS_ACCOUNT_ID, amount: "-10" },
        { walletBalanceId: PURCHASED_ACCOUNT_ID, amount: "10" },
      ],
      metadata: {},
    }))
    .digest("hex");
  const { persistence, entries, statements } = createPersistence({
    existingOperation: {
      id: "operation-existing",
      operation_type: baseInput.operationType,
      request_fingerprint: fingerprint,
      reference_type: baseInput.referenceType,
      reference_id: baseInput.referenceId,
    },
  });

  const result = await postWalletOperation(baseInput, persistence);

  assert.equal(result.operationId, "operation-existing");
  assert.equal(result.replayed, true);
  assert.equal(entries.length, 0);
  assert.equal(statements.at(-1)?.text, "COMMIT");
});
