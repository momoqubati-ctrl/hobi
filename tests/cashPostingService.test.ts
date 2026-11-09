import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  ensureCashAccount,
  postCashOperation,
  CashPostingError,
  type CashAccountProvisioningPersistence,
  type CashPostingPersistence,
} from "../server/services/cashPostingService";
import type { PoolClient } from "pg";

const MEMBER_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const CLEARING_ACCOUNT_ID = "b0000000-0000-4000-8000-000000000002";

test("cash account provisioning keeps hosting owner as an external identity", async () => {
  let insertedValues: unknown[] | undefined;
  const persistence = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('INSERT INTO "cash_accounts"')) {
        insertedValues = values;
        return { rows: [{ id: MEMBER_ACCOUNT_ID }] };
      }
      return { rows: [] };
    },
  };

  const result = await ensureCashAccount(
    {
      ownerType: "hosting_owner",
      ownerReference: "Hosting.A",
      bucket: "hosting_profit",
      currencyCode: "usd",
    },
    persistence as unknown as CashAccountProvisioningPersistence,
  );

  assert.equal(result.cashAccountId, MEMBER_ACCOUNT_ID);
  assert.equal(result.created, true);
  assert.deepEqual(insertedValues, [
    "hosting_owner",
    null,
    null,
    "hosting.a",
    "hosting_profit",
    "USD",
  ]);
});

test("cash account provisioning rejects invalid owner identities before database access", async () => {
  let queried = false;
  const persistence = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };

  await assert.rejects(
    ensureCashAccount(
      {
        ownerType: "site_owner",
        ownerUserId: "",
        bucket: "site_profit",
        currencyCode: "USD",
      },
      persistence as unknown as CashAccountProvisioningPersistence,
    ),
    (error: unknown) => error instanceof CashPostingError && error.code === "INVALID_ACCOUNT",
  );
  assert.equal(queried, false);
});

test("cash account provisioning returns an existing identity and currency account", async () => {
  const persistence = {
    async query(text: string) {
      return text.includes("INSERT INTO")
        ? { rows: [] }
        : { rows: [{ id: MEMBER_ACCOUNT_ID }] };
    },
  };

  const result = await ensureCashAccount(
    {
      ownerType: "site_owner",
      ownerUserId: "site-owner",
      bucket: "site_profit",
      currencyCode: "USD",
    },
    persistence as unknown as CashAccountProvisioningPersistence,
  );

  assert.deepEqual(result, { cashAccountId: MEMBER_ACCOUNT_ID, created: false });
});

test("cash account provisioning supports withdrawable claims and platform cash assets", async () => {
  const inserted: unknown[][] = [];
  const persistence = {
    async query(text: string, values?: unknown[]) {
      if (text.includes("INSERT INTO")) {
        inserted.push(values ?? []);
        return { rows: [{ id: MEMBER_ACCOUNT_ID }] };
      }
      return { rows: [] };
    },
  };

  await ensureCashAccount(
    {
      ownerType: "member",
      ownerUserId: "member-1",
      bucket: "withdrawable_balance",
      currencyCode: "USD",
    },
    persistence as unknown as CashAccountProvisioningPersistence,
  );
  await ensureCashAccount(
    {
      ownerType: "system",
      bucket: "platform_cash_asset",
      currencyCode: "USD",
    },
    persistence as unknown as CashAccountProvisioningPersistence,
  );

  assert.equal(inserted[0][4], "withdrawable_balance");
  assert.equal(inserted[1][4], "platform_cash_asset");
});

const input = {
  actorScope: "member" as const,
  actorUserId: "member-a",
  operationType: "gift_earnings_reserve",
  idempotencyKey: "cash-operation-1",
  currencyCode: "USD",
  referenceType: "payout",
  referenceId: "payout-1",
  postings: [
    { cashAccountId: MEMBER_ACCOUNT_ID, amountMinorUnits: -1200n },
    { cashAccountId: CLEARING_ACCOUNT_ID, amountMinorUnits: 1200n },
  ],
};

function createPersistence(options: {
  balances?: Record<string, string>;
  accountOwners?: Record<string, { ownerType: string; userId?: string | null; agentId?: string | null }>;
  currencies?: Record<string, string>;
  existingOperation?: {
    id: string;
    operation_type: string;
    request_fingerprint: string;
    reference_type: string | null;
    reference_id: string | null;
    currency_code: string;
  };
} = {}) {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const balances = new Map(Object.entries(options.balances ?? {
    [MEMBER_ACCOUNT_ID]: "5000",
    [CLEARING_ACCOUNT_ID]: "0",
  }));
  const entries: bigint[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push({ text, values });
      if (text.includes('FROM "cash_operations"') && text.includes("FOR UPDATE")) {
        return { rows: options.existingOperation ? [options.existingOperation] : [] };
      }
      if (text.includes('FROM "cash_accounts"') && text.includes("FOR UPDATE")) {
        const ids = values?.[0] as string[];
        return {
          rows: ids.map((id) => {
            const owner = options.accountOwners?.[id] ?? (
              id === MEMBER_ACCOUNT_ID
                ? { ownerType: "member", userId: "member-a" }
                : { ownerType: "system" }
            );
            return {
              id,
              owner_type: owner.ownerType,
              owner_user_id: owner.userId ?? null,
              owner_agent_id: owner.agentId ?? null,
              owner_reference: null,
              bucket: owner.ownerType === "system" ? "settlement_clearing" : "recipient_earnings",
              currency_code: options.currencies?.[id] ?? "USD",
              balance_minor_units: balances.get(id) ?? "0",
            };
          }),
        };
      }
      if (text.includes('INSERT INTO "cash_operations"')) {
        return { rows: [{ id: "c0000000-0000-4000-8000-000000000003" }] };
      }
      if (text.includes('UPDATE "cash_accounts"')) {
        const accountId = String(values?.[1]);
        const next = BigInt(balances.get(accountId) ?? "0") + BigInt(String(values?.[0]));
        if (next < 0n) return { rows: [] };
        balances.set(accountId, next.toString());
        return { rows: [{ id: accountId }] };
      }
      if (text.includes('INSERT INTO "cash_entries"')) {
        entries.push(BigInt(String(values?.[3])));
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const persistence: CashPostingPersistence = { connect: async () => client };
  return { persistence, statements, balances, entries };
}

test("cash posting rejects unbalanced amounts before opening a database connection", async () => {
  let connected = false;
  const persistence: CashPostingPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("unexpected connection");
    },
  };

  await assert.rejects(
    postCashOperation({
      ...input,
      postings: [
        { cashAccountId: MEMBER_ACCOUNT_ID, amountMinorUnits: -1200n },
        { cashAccountId: CLEARING_ACCOUNT_ID, amountMinorUnits: 1199n },
      ],
    }, persistence),
    (error: unknown) => error instanceof CashPostingError && error.code === "UNBALANCED_OPERATION",
  );
  assert.equal(connected, false);
});

test("cash posting atomically updates same-currency owned accounts", async () => {
  const fake = createPersistence();

  const result = await postCashOperation(input, fake.persistence);

  assert.equal(result.replayed, false);
  assert.equal(fake.balances.get(MEMBER_ACCOUNT_ID), "3800");
  assert.equal(fake.balances.get(CLEARING_ACCOUNT_ID), "1200");
  assert.deepEqual(fake.entries, [-1200n, 1200n]);
  assert.equal(fake.entries.reduce((sum, amount) => sum + amount, 0n), 0n);
  assert.equal(fake.statements.at(-1)?.text, "COMMIT");
});

test("cash posting rejects a member account owned by a different user", async () => {
  const fake = createPersistence({
    accountOwners: {
      [MEMBER_ACCOUNT_ID]: { ownerType: "member", userId: "member-b" },
      [CLEARING_ACCOUNT_ID]: { ownerType: "system" },
    },
  });

  await assert.rejects(
    postCashOperation(input, fake.persistence),
    (error: unknown) => error instanceof CashPostingError && error.code === "ACTOR_ACCOUNT_MISMATCH",
  );
  assert.equal(fake.statements.at(-1)?.text, "ROLLBACK");
});

test("cash posting rejects accounts in a different currency", async () => {
  const fake = createPersistence({ currencies: { [CLEARING_ACCOUNT_ID]: "EUR" } });

  await assert.rejects(
    postCashOperation(input, fake.persistence),
    (error: unknown) => error instanceof CashPostingError && error.code === "CURRENCY_MISMATCH",
  );
  assert.equal(fake.statements.at(-1)?.text, "ROLLBACK");
});

test("cash posting replays the original operation only for the same fingerprint", async () => {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      actorScope: input.actorScope,
      actorUserId: input.actorUserId,
      actorAgentId: null,
      operationType: input.operationType,
      currencyCode: input.currencyCode,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      postings: [
        { cashAccountId: MEMBER_ACCOUNT_ID, amountMinorUnits: "-1200" },
        { cashAccountId: CLEARING_ACCOUNT_ID, amountMinorUnits: "1200" },
      ],
      metadata: {},
    }))
    .digest("hex");
  const fake = createPersistence({
    existingOperation: {
      id: "cash-operation-existing",
      operation_type: input.operationType,
      request_fingerprint: fingerprint,
      reference_type: input.referenceType,
      reference_id: input.referenceId,
      currency_code: input.currencyCode,
    },
  });

  const result = await postCashOperation(input, fake.persistence);

  assert.equal(result.operationId, "cash-operation-existing");
  assert.equal(result.replayed, true);
  assert.deepEqual(fake.entries, []);
  assert.equal(fake.statements.at(-1)?.text, "COMMIT");
});
