import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  approveAgentInventoryOrder,
  createAgentInventoryOrder,
  getAgentInventoryBalance,
  quoteAgentInventoryOrder,
  rejectAgentInventoryOrder,
  submitAgentInventoryOrderPayment,
  AgentInventoryError,
  type AgentInventoryPersistence,
} from "../server/services/agentInventoryService";

const agentId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const validOrder = {
  id: orderId,
  agent_id: agentId,
  requested_coins: "100",
  quoted_price_minor_units: "5000",
  currency_code: "YER",
  payment_instructions_snapshot: "حوّل إلى حساب الموقع",
  payment_reference: "transfer-001",
  proof_object_key: "wallet-proofs/33333333-3333-4333-8333-333333333333",
  proof_uploaded_at: new Date(),
  status: "submitted",
  settlement_operation_id: null,
  reviewed_by_user_id: null,
  created_at: new Date("2026-11-01T10:00:00.000Z"),
};

test("agent inventory balance reads only the requested agent and returns zero before its ledger account is created", async () => {
  const balances = new Map([[agentId, "250"]]);
  const readBalance = async (requestedAgentId: string) => balances.get(requestedAgentId) ?? null;

  assert.equal(await getAgentInventoryBalance(agentId, readBalance), "250");
  assert.equal(
    await getAgentInventoryBalance("33333333-3333-4333-8333-333333333333", readBalance),
    "0",
  );
});

function createInventoryPersistence(options: {
  order?: Record<string, unknown> | null;
  siteBalance?: string;
  agentBalance?: string;
  failOn?: string;
  emptyInsert?: boolean;
} = {}) {
  const statements: string[] = [];
  const entries: Array<{ balanceId: string; amount: string }> = [];
  const operations: Array<Record<string, unknown>> = [];
  const balances = [
    { id: "site-inventory", account_type: "system", user_id: null, agent_id: null, bucket: "site_inventory", balance_coins: options.siteBalance ?? "1000" },
    { id: "agent-inventory", account_type: "agent", user_id: null, agent_id: agentId, bucket: "agent_inventory", balance_coins: options.agentBalance ?? "25" },
  ];
  let order = options.order === undefined ? { ...validOrder } : options.order;
  let transactionSnapshot: {
    balances: typeof balances;
    entriesLength: number;
    operationsLength: number;
    order: Record<string, unknown> | null;
  } | null = null;
  const client = {
    async query(text: string, values: unknown[] = []) {
      statements.push(text);
      if (options.failOn && text.includes(options.failOn)) {
        throw new Error("simulated inventory persistence failure");
      }
      if (text === "BEGIN") {
        transactionSnapshot = {
          balances: balances.map((balance) => ({ ...balance })),
          entriesLength: entries.length,
          operationsLength: operations.length,
          order: order ? { ...order } : null,
        };
        return { rows: [] };
      }
      if (text === "ROLLBACK") {
        if (transactionSnapshot) {
          balances.splice(0, balances.length, ...transactionSnapshot.balances.map((balance) => ({ ...balance })));
          entries.length = transactionSnapshot.entriesLength;
          operations.length = transactionSnapshot.operationsLength;
          order = transactionSnapshot.order ? { ...transactionSnapshot.order } : null;
        }
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO \"wallet_agent_inventory_orders\"")) {
        if (options.emptyInsert) return { rows: [] };
        return {
          rows: [{
            id: orderId,
            requested_coins: String(values[1]),
            status: "requested",
            created_at: new Date("2026-11-01T10:00:00.000Z"),
          }],
        };
      }
      if (text.includes('FROM "wallet_agent_inventory_orders"') && text.includes("FOR UPDATE")) {
        return { rows: order ? [order] : [] };
      }
      if (text.includes('INSERT INTO "wallet_balances"')) {
        return { rows: [] };
      }
      if (text.includes('FROM "wallet_balances"') && text.includes("FOR UPDATE")) {
        return { rows: balances };
      }
      if (text.includes('INSERT INTO "wallet_operations"')) {
        const operation = {
          id: "settlement-operation",
          created_at: new Date("2026-11-01T10:05:00.000Z"),
          metadata: JSON.parse(String(values[5])),
        };
        operations.push(operation);
        return { rows: [operation] };
      }
      if (text.includes('FROM "wallet_operations"') && text.includes("metadata")) {
        const operation = operations.find((item) => item.id === values[0]);
        const metadata = operation?.metadata as Record<string, string> | undefined;
        return {
          rows: metadata ? [{
            site_balance_after: metadata.siteBalanceAfter,
            agent_balance_after: metadata.agentBalanceAfter,
          }] : [],
        };
      }
      if (text.includes('UPDATE "wallet_balances"')) {
        const balance = balances.find((item) => item.id === values[1]);
        if (!balance) return { rows: [] };
        balance.balance_coins = String(BigInt(balance.balance_coins) + BigInt(String(values[0])));
        return { rows: [{ id: balance.id, balance_coins: balance.balance_coins }] };
      }
      if (text.includes('INSERT INTO "wallet_entries"')) {
        entries.push({ balanceId: String(values[1]), amount: String(values[2]) });
        return { rows: [] };
      }
      if (text.includes('UPDATE "wallet_agent_inventory_orders"')) {
        const status = text.includes("SET \"status\" = 'quoted'")
          ? "quoted"
          : text.includes("SET \"status\" = 'submitted'")
            ? "submitted"
            : text.includes("SET \"status\" = 'rejected'")
              ? "rejected"
              : "approved";
        if (order) {
          order = {
            ...order,
            status,
            ...(status === "quoted" ? {
              quoted_price_minor_units: String(values[0]),
              currency_code: values[1],
              payment_instructions_snapshot: values[2],
              quoted_by_user_id: values[3],
            } : {}),
            ...(status === "submitted" ? {
              payment_reference: values[0],
              proof_object_key: values[1],
              proof_uploaded_at: new Date(),
            } : {}),
            ...(status === "rejected" ? {
              reviewed_by_user_id: values[0],
              rejection_reason: values[1],
            } : {}),
            ...(status === "approved" ? {
              reviewed_by_user_id: values[0],
              settlement_operation_id: values[1],
            } : {}),
          };
        }
        return { rowCount: 1, rows: [{ id: orderId, status }] };
      }
      if (text === "COMMIT") return { rows: [] };
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const persistence: AgentInventoryPersistence = { connect: async () => client };
  return { persistence, statements, entries, operations, balances };
}

test("agent inventory requests reject malformed quantities before connecting", async () => {
  let connected = false;
  const persistence: AgentInventoryPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };

  await assert.rejects(
    createAgentInventoryOrder({ agentId, requestedCoins: 0, idempotencyKey: "stock-1" }, persistence),
    { code: "INVALID_INVENTORY_ORDER" },
  );
  assert.equal(connected, false);
});

test("site-owner stock settlement requires explicit payment verification", async () => {
  let connected = false;
  const persistence: AgentInventoryPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };
  await assert.rejects(
    approveAgentInventoryOrder({
      orderId,
      siteOwnerUserId: "site-owner-user",
      paymentVerified: false,
    }, persistence),
    { code: "PAYMENT_NOT_VERIFIED" },
  );
  assert.equal(connected, false);
});

test("replaying an inventory request with a reused key and changed amount conflicts", async () => {
  const fake = createInventoryPersistence({ emptyInsert: true });

  await assert.rejects(
    createAgentInventoryOrder({
      agentId,
      requestedCoins: 101,
      idempotencyKey: "stock-order-1",
    }, fake.persistence),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
});

test("site owner quotes an agent inventory request without moving coins", async () => {
  const fake = createInventoryPersistence({
    order: { ...validOrder, status: "requested", quoted_price_minor_units: null, currency_code: null },
  });

  const result = await quoteAgentInventoryOrder({
    orderId,
    siteOwnerUserId: "site-owner-user",
    priceMinorUnits: 5000,
    currencyCode: "YER",
    paymentInstructions: "حوّل إلى حساب الموقع",
  }, fake.persistence);

  assert.equal(result.status, "quoted");
  assert.equal(result.replayed, false);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.statements.at(-1), "COMMIT");
});

test("replaying an approved inventory order does not post a second settlement", async () => {
  const fake = createInventoryPersistence();

  const first = await approveAgentInventoryOrder(
    { orderId, siteOwnerUserId: "site-owner-user", paymentVerified: true },
    fake.persistence,
  );
  const replay = await approveAgentInventoryOrder(
    { orderId, siteOwnerUserId: "site-owner-user", paymentVerified: true },
    fake.persistence,
  );

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(fake.operations.length, 1);
  assert.equal(fake.entries.length, 2);
  assert.equal(fake.balances[0].balance_coins, "900");
  assert.equal(fake.balances[1].balance_coins, "125");
});

test("ledger write failure rolls back the inventory operation and both balances", async () => {
  const fake = createInventoryPersistence({ failOn: 'INSERT INTO "wallet_entries"' });

  await assert.rejects(
    approveAgentInventoryOrder({ orderId, siteOwnerUserId: "site-owner-user", paymentVerified: true }, fake.persistence),
  );

  assert.equal(fake.statements.at(-1), "ROLLBACK");
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.balances[0].balance_coins, "1000");
  assert.equal(fake.balances[1].balance_coins, "25");
});

test("invalid inventory quote currency is rejected before connecting", async () => {
  let connected = false;
  const persistence: AgentInventoryPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };

  await assert.rejects(
    quoteAgentInventoryOrder({
      orderId,
      siteOwnerUserId: "site-owner-user",
      priceMinorUnits: 5000,
      currencyCode: "Yemeni Rial",
      paymentInstructions: "Payment details",
    }, persistence),
    { code: "INVALID_INVENTORY_QUOTE" },
  );
  assert.equal(connected, false);
});

test("agent submits a payment reference and a private receipt for a quoted order", async () => {
  const fake = createInventoryPersistence({
    order: { ...validOrder, status: "quoted", payment_reference: null, proof_object_key: null },
  });

  const result = await submitAgentInventoryOrderPayment({
    orderId,
    agentId,
    paymentReference: " transfer-002 ",
    proofObjectKey: "wallet-proofs/33333333-3333-4333-8333-333333333333",
  }, fake.persistence);

  assert.equal(result.status, "submitted");
  assert.equal(result.replayed, false);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.statements.at(-1), "COMMIT");
});

test("agent inventory receipts reject object keys outside the private proof namespace", async () => {
  let connected = false;
  const persistence: AgentInventoryPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
  };

  await assert.rejects(
    submitAgentInventoryOrderPayment({
      orderId,
      agentId,
      paymentReference: "transfer-002",
      proofObjectKey: "public/receipt.png",
    }, persistence),
    { code: "INVALID_INVENTORY_PAYMENT" },
  );
  assert.equal(connected, false);
});

test("site owner may reject an inventory request without creating a ledger posting", async () => {
  const fake = createInventoryPersistence();

  const result = await rejectAgentInventoryOrder({
    orderId,
    siteOwnerUserId: "site-owner-user",
    reason: "تعذر التحقق من التحويل",
  }, fake.persistence);

  assert.equal(result.status, "rejected");
  assert.equal(result.replayed, false);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.statements.at(-1), "COMMIT");
});

test("creating an agent inventory request does not create or move wallet balances", async () => {
  const fake = createInventoryPersistence();

  const result = await createAgentInventoryOrder({
    agentId,
    requestedCoins: 100,
    idempotencyKey: "stock-order-1",
  }, fake.persistence);

  assert.equal(result.id, orderId);
  assert.equal(result.status, "requested");
  assert.equal(result.replayed, false);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.operations.length, 0);
  assert.equal(fake.balances[0].balance_coins, "1000");
});

test("site-owner approval posts balanced site and agent entries atomically", async () => {
  const fake = createInventoryPersistence();

  const result = await approveAgentInventoryOrder({
    orderId,
    siteOwnerUserId: "site-owner-user",
    paymentVerified: true,
  }, fake.persistence);

  assert.equal(result.id, orderId);
  assert.equal(result.agentBalance, "125");
  assert.equal(result.siteWalletBalance, "900");
  assert.deepEqual(fake.entries, [
    { balanceId: "site-inventory", amount: "-100" },
    { balanceId: "agent-inventory", amount: "100" },
  ]);
  assert.equal(fake.entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n), 0n);
  assert.equal(fake.operations.length, 1);
  assert.equal(fake.statements.at(-1), "COMMIT");
  assert.equal(fake.statements.includes("ROLLBACK"), false);
});

test("agent stock cannot be approved when site inventory is insufficient", async () => {
  const fake = createInventoryPersistence({ siteBalance: "99" });

  await assert.rejects(
    approveAgentInventoryOrder({ orderId, siteOwnerUserId: "site-owner-user", paymentVerified: true }, fake.persistence),
    (error: unknown) =>
      error instanceof AgentInventoryError && error.code === "INSUFFICIENT_SITE_INVENTORY",
  );

  assert.equal(fake.operations.length, 0);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});

test("only a submitted inventory order can be approved", async () => {
  const fake = createInventoryPersistence({ order: { ...validOrder, status: "quoted" } });

  await assert.rejects(
    approveAgentInventoryOrder({ orderId, siteOwnerUserId: "site-owner-user", paymentVerified: true }, fake.persistence),
    (error: unknown) =>
      error instanceof AgentInventoryError && error.code === "INVENTORY_ORDER_NOT_PAYABLE",
  );

  assert.equal(fake.operations.length, 0);
  assert.equal(fake.entries.length, 0);
  assert.equal(fake.statements.at(-1), "ROLLBACK");
});
