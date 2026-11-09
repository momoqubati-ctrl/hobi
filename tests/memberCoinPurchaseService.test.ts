import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  approveMemberCoinPurchase,
  createMemberCoinPurchase,
  rejectMemberCoinPurchase,
  submitMemberCoinPurchasePayment,
  MemberCoinPurchaseError,
  type MemberCoinPurchasePersistence,
} from "../server/services/memberCoinPurchaseService";

const memberId = "member-001";
const agentId = "11111111-1111-4111-8111-111111111111";
const otherAgentId = "33333333-3333-4333-8333-333333333333";
const packageId = "44444444-4444-4444-8444-444444444444";
const purchaseId = "55555555-5555-4555-8555-555555555555";

const validPurchase = {
  id: purchaseId,
  member_user_id: memberId,
  agent_id: agentId,
  coin_amount: "100",
  price_minor_units: "2500",
  currency_code: "YER",
  payment_instructions_snapshot: "حوّل إلى حساب الوكيل",
  payment_reference: "member-transfer-001",
  proof_object_key: "wallet-proofs/66666666-6666-4666-8666-666666666666.jpg",
  proof_uploaded_at: new Date(),
  receipt_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  status: "submitted",
  settlement_operation_id: null,
  reviewed_by_agent_id: null,
  rejection_reason: null,
};

function createPersistence(options: {
  purchase?: Record<string, unknown> | null;
  agentBalance?: string;
  memberBalance?: string;
  failOn?: string;
} = {}) {
  const statements: string[] = [];
  const operations: Array<Record<string, unknown>> = [];
  const entries: Array<{ balanceId: string; amount: string }> = [];
  const balances = [
    { id: "agent-inventory", account_type: "agent", user_id: null, agent_id: agentId, bucket: "agent_inventory", balance_coins: options.agentBalance ?? "500" },
    { id: "member-cashable", account_type: "member", user_id: memberId, agent_id: null, bucket: "cashable_spendable", balance_coins: options.memberBalance ?? "20" },
  ];
  let purchase = options.purchase === undefined ? { ...validPurchase } : options.purchase;
  let transactionSnapshot: {
    balances: typeof balances;
    operationLength: number;
    entryLength: number;
    purchase: Record<string, unknown> | null;
  } | null = null;
  const client = {
    async query(text: string, values: unknown[] = []) {
      statements.push(text);
      if (options.failOn && text.includes(options.failOn)) throw new Error("simulated DB failure");
      if (text === "BEGIN") {
        transactionSnapshot = {
          balances: balances.map((item) => ({ ...item })),
          operationLength: operations.length,
          entryLength: entries.length,
          purchase: purchase ? { ...purchase } : null,
        };
        return { rows: [] };
      }
      if (text === "ROLLBACK") {
        if (transactionSnapshot) {
          balances.splice(0, balances.length, ...transactionSnapshot.balances.map((item) => ({ ...item })));
          operations.length = transactionSnapshot.operationLength;
          entries.length = transactionSnapshot.entryLength;
          purchase = transactionSnapshot.purchase ? { ...transactionSnapshot.purchase } : null;
        }
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO \"member_coin_purchases\"")) {
        return { rows: [{ id: purchaseId, member_user_id: memberId, agent_id: agentId, status: "awaiting_payment" }] };
      }
      if (text.includes('FROM "member_coin_purchases"') && text.includes("FOR UPDATE")) {
        if (values[1] !== undefined && values[1] !== agentId) return { rows: [] };
        return { rows: purchase ? [purchase] : [] };
      }
      if (text.includes('INSERT INTO "wallet_balances"')) return { rows: [] };
      if (text.includes('FROM "wallet_balances"') && text.includes("FOR UPDATE")) return { rows: balances };
      if (text.includes('INSERT INTO "wallet_operations"')) {
        const operation = {
          id: "member-settlement-operation",
          metadata: JSON.parse(String(values[6])),
        };
        operations.push(operation);
        return { rows: [operation] };
      }
      if (text.includes('FROM "wallet_operations"') && text.includes("metadata")) {
        const operation = operations.find((item) => item.id === values[0]);
        const metadata = operation?.metadata as Record<string, string> | undefined;
        return {
          rows: metadata ? [{
            agent_balance_after: metadata.agentBalanceAfter,
            member_balance_after: metadata.memberBalanceAfter,
          }] : [],
        };
      }
      if (text.includes('UPDATE "wallet_balances"')) {
        const account = balances.find((row) => row.id === values[1]);
        if (!account) return { rows: [] };
        account.balance_coins = String(BigInt(account.balance_coins) + BigInt(String(values[0])));
        return { rows: [{ id: account.id, balance_coins: account.balance_coins }] };
      }
      if (text.includes('INSERT INTO "wallet_entries"')) {
        entries.push({ balanceId: String(values[1]), amount: String(values[2]) });
        return { rows: [] };
      }
      if (text.includes('UPDATE "member_coin_purchases"')) {
        const status = text.includes("'approved'") ? "approved" : "rejected";
        purchase = purchase ? {
          ...purchase,
          status,
          reviewed_by_agent_id: status === "approved" ? values[0] : values[0],
          settlement_operation_id: status === "approved" ? values[1] : null,
          rejection_reason: status === "rejected" ? values[1] : null,
        } : null;
        return { rowCount: 1, rows: [{ id: purchaseId, status }] };
      }
      if (text === "COMMIT") return { rows: [] };
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const persistence: MemberCoinPurchasePersistence = { connect: async () => client };
  return { persistence, statements, operations, entries, balances };
}

test("member purchase rejects malformed identity, package, and idempotency key before connecting", async () => {
  let connected = false;
  const persistence: MemberCoinPurchasePersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };

  await assert.rejects(
    createMemberCoinPurchase({
      memberUserId: memberId,
      agentId: "not-an-agent",
      packageId,
      idempotencyKey: "purchase-1",
    }, persistence),
    { code: "INVALID_MEMBER_PURCHASE" },
  );
  assert.equal(connected, false);
});

test("agent purchase settlement requires explicit payment verification", async () => {
  let connected = false;
  const persistence: MemberCoinPurchasePersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };
  await assert.rejects(
    approveMemberCoinPurchase({
      purchaseId,
      agentId,
      paymentVerified: false,
    }, persistence),
    { code: "PAYMENT_NOT_VERIFIED" },
  );
  assert.equal(connected, false);
});

test("member purchase approval atomically transfers agent inventory into the member cashable wallet", async () => {
  const fake = createPersistence();

  const result = await approveMemberCoinPurchase({
    purchaseId,
    agentId,
    paymentVerified: true,
  }, fake.persistence);

  assert.equal(result.status, "approved");
  assert.equal(fake.operations.length, 1);
  assert.deepEqual(fake.entries, [
    { balanceId: "agent-inventory", amount: "-100" },
    { balanceId: "member-cashable", amount: "100" },
  ]);
  assert.equal(fake.balances[0].balance_coins, "400");
  assert.equal(fake.balances[1].balance_coins, "120");
  assert.equal(fake.statements.at(-1), "COMMIT");
});

test("another agent cannot settle a purchase assigned to a different agent", async () => {
  const fake = createPersistence();

  await assert.rejects(
    approveMemberCoinPurchase({ purchaseId, agentId: otherAgentId, paymentVerified: true }, fake.persistence),
    (error: unknown) =>
      error instanceof MemberCoinPurchaseError && error.code === "MEMBER_PURCHASE_NOT_FOUND",
  );
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("member purchase cannot be approved when the selected agent inventory is insufficient", async () => {
  const fake = createPersistence({ agentBalance: "99" });

  await assert.rejects(
    approveMemberCoinPurchase({ purchaseId, agentId, paymentVerified: true }, fake.persistence),
    (error: unknown) =>
      error instanceof MemberCoinPurchaseError && error.code === "INSUFFICIENT_AGENT_INVENTORY",
  );
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("replaying an approved member purchase does not credit the wallet twice", async () => {
  const fake = createPersistence();
  await approveMemberCoinPurchase({ purchaseId, agentId, paymentVerified: true }, fake.persistence);

  const replay = await approveMemberCoinPurchase({ purchaseId, agentId, paymentVerified: true }, fake.persistence);

  assert.equal(replay.replayed, true);
  assert.equal(fake.operations.length, 1);
  assert.equal(fake.entries.length, 2);
  assert.equal(fake.balances[0].balance_coins, "400");
  assert.equal(fake.balances[1].balance_coins, "120");
});

test("agent rejection records a reason without changing ledger balances", async () => {
  const fake = createPersistence();

  const result = await rejectMemberCoinPurchase({
    purchaseId,
    agentId,
    reason: "لم يتم العثور على التحويل",
  }, fake.persistence);

  assert.equal(result.status, "rejected");
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.balances[0].balance_coins, "500");
  assert.equal(fake.balances[1].balance_coins, "20");
});

test("member receipt upload rejects public or malformed object keys before connecting", async () => {
  let connected = false;
  const persistence: MemberCoinPurchasePersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };
  await assert.rejects(
    submitMemberCoinPurchasePayment({
      purchaseId,
      memberUserId: memberId,
      paymentReference: "payment-123",
      proofObjectKey: "public/receipt.png",
    }, persistence),
    (error: unknown) =>
      error instanceof MemberCoinPurchaseError && error.code === "INVALID_MEMBER_PAYMENT",
  );
  assert.equal(connected, false);
});
