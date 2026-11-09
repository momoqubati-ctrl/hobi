import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  getWalletSummary,
  planGiftSettlement,
  sendGiftFromWallet,
} from "../server/services/coinLedgerService";
import type { GiftLedgerPersistence } from "../server/services/coinLedgerService";

test("gift settlement spends legacy coins first and preserves source eligibility", () => {
  const settlement = planGiftSettlement(100n, 60n, 80n, 1_000);

  assert.deepEqual(settlement, {
    totalCoins: 100n,
    commissionCoins: 10n,
    legacyDebitCoins: 60n,
    cashableDebitCoins: 40n,
    legacyCommissionCoins: 6n,
    cashableCommissionCoins: 4n,
    legacyRecipientCreditCoins: 54n,
    cashableRecipientCreditCoins: 36n,
  });
});

test("gift settlement rejects a debit larger than all spendable source balances", () => {
  assert.throws(() => planGiftSettlement(101n, 60n, 40n, 500), {
    code: "INSUFFICIENT_FUNDS",
  });
});

test("a full commission leaves no recipient credit but conserves the total debit", () => {
  const settlement = planGiftSettlement(5n, 5n, 0n, 10_000);

  assert.equal(settlement.legacyRecipientCreditCoins, 0n);
  assert.equal(settlement.cashableRecipientCreditCoins, 0n);
  assert.equal(settlement.commissionCoins, settlement.totalCoins);
});

test("gift sends reject self-gifting without opening a database connection", async () => {
  let connected = false;
  const persistence: GiftLedgerPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("unexpected connection");
    },
    awardExperience: async () => {},
  };

  await assert.rejects(
    sendGiftFromWallet(
      {
        senderUserId: "member-1",
        receiverUserId: "member-1",
        giftId: "00000000-0000-0000-0000-000000000001",
        quantity: 1,
        idempotencyKey: "gift-attempt-1",
      },
      persistence,
    ),
    { code: "INVALID_GIFT" },
  );
  assert.equal(connected, false);
});

test("gift sends fail closed until the legacy wallet opening commits", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows: [] };
    },
    release() {},
  };
  const persistence: GiftLedgerPersistence = {
    connect: async () => client as unknown as import("pg").PoolClient,
    awardExperience: async () => {},
  };

  await assert.rejects(
    sendGiftFromWallet(
      {
        senderUserId: "member-1",
        receiverUserId: "member-2",
        giftId: "00000000-0000-0000-0000-000000000001",
        quantity: 1,
        idempotencyKey: "gift-attempt-2",
      },
      persistence,
    ),
    { code: "WALLET_CUTOVER_PENDING" },
  );
  assert.equal(statements.at(-1), "ROLLBACK");
});

test("gift posting records balanced source-aware entries atomically", async () => {
  const statements: string[] = [];
  const entryAmounts: bigint[] = [];
  const giftId = "00000000-0000-0000-0000-000000000001";
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push(text);
      if (text.includes("operation_type") && text.includes("legacy_opening")) {
        return { rows: [{ id: "opening-operation" }] };
      }
      if (text.includes('"request_fingerprint"') && text.includes("FOR UPDATE")) {
        return { rows: [] };
      }
      if (text.includes('FROM "gift_catalog"')) {
        return { rows: [{ id: giftId, price: 100 }] };
      }
      if (text.includes('FROM "wallet_settings"')) {
        return { rows: [{ value: { commissionRateBasisPoints: 1_000 } }] };
      }
      if (text.includes('FROM "wallet_balances"') && text.includes("FOR UPDATE")) {
        return {
          rows: [
            { id: "sender-legacy", user_id: "member-1", bucket: "legacy_spendable", balance_coins: "60" },
            { id: "sender-cashable", user_id: "member-1", bucket: "cashable_spendable", balance_coins: "80" },
            { id: "receiver-legacy", user_id: "member-2", bucket: "legacy_spendable", balance_coins: "0" },
            { id: "receiver-cashable", user_id: "member-2", bucket: "cashable_spendable", balance_coins: "0" },
            { id: "platform-fee", user_id: null, bucket: "platform_fee", balance_coins: "0" },
          ],
        };
      }
      if (text.includes('INSERT INTO "wallet_operations"')) {
        return { rows: [{ id: "operation-1" }] };
      }
      if (text.includes('INSERT INTO "gift_transactions"')) {
        return { rows: [{ created_at: new Date("2026-01-01T00:00:00.000Z") }] };
      }
      if (text.includes('INSERT INTO "wallet_entries"')) {
        entryAmounts.push(BigInt(String(values?.[2])));
      }
      if (text.includes('UPDATE "wallet_balances"')) {
        return { rows: [{ id: values?.[1] }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const persistence: GiftLedgerPersistence = {
    connect: async () => client as unknown as import("pg").PoolClient,
    awardExperience: async () => {},
  };

  const result = await sendGiftFromWallet(
    {
      senderUserId: "member-1",
      receiverUserId: "member-2",
      giftId,
      quantity: 1,
      idempotencyKey: "gift-attempt-success",
    },
    persistence,
  );

  assert.equal(result.totalCoins, 100);
  assert.equal(result.newBalance, "40");
  assert.equal(entryAmounts.length, 5);
  assert.equal(entryAmounts.reduce((sum, amount) => sum + amount, 0n), 0n);
  assert.equal(statements.at(-1), "COMMIT");
  assert.equal(statements.includes("ROLLBACK"), false);
});

test("replaying a gift idempotency key returns its original result without posting again", async () => {
  const statements: string[] = [];
  const input = {
    senderUserId: "member-1",
    receiverUserId: "member-2",
    giftId: "00000000-0000-0000-0000-000000000001",
    quantity: 1,
    idempotencyKey: "gift-attempt-replay",
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      operationType: "gift",
      senderUserId: input.senderUserId,
      receiverUserId: input.receiverUserId,
      giftId: input.giftId,
      quantity: input.quantity,
    }))
    .digest("hex");
  const client = {
    async query(text: string) {
      statements.push(text);
      if (text.includes("operation_type") && text.includes("legacy_opening")) {
        return { rows: [{ id: "opening-operation" }] };
      }
      if (text.includes('"request_fingerprint"') && text.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: "operation-1",
            request_fingerprint: fingerprint,
            reference_id: "gift-transaction-1",
            metadata: { senderSpendableAfter: "40" },
          }],
        };
      }
      if (text.includes('FROM "gift_transactions"')) {
        return {
          rows: [{
            id: "gift-transaction-1",
            total_coins: 100,
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const persistence: GiftLedgerPersistence = {
    connect: async () => client as unknown as import("pg").PoolClient,
    awardExperience: async () => {},
  };

  const result = await sendGiftFromWallet(input, persistence);

  assert.equal(result.replayed, true);
  assert.equal(result.newBalance, "40");
  assert.equal(statements.some((statement) => statement.includes('INSERT INTO "wallet_entries"')), false);
  assert.equal(statements.at(-1), "COMMIT");
});

test("wallet balance reads use legacy coins before cutover and wallet buckets afterward", async () => {
  const preCutover = await getWalletSummary("member-1", {
    async query(text: string) {
      return text.includes("legacy-opening")
        ? { rows: [] }
        : { rows: [{ coins: "125" }] };
    },
  } as unknown as import("../server/services/coinLedgerService").WalletReadPersistence);

  assert.deepEqual(preCutover, { coins: "125", cashableCoins: "0" });

  const postCutover = await getWalletSummary("member-1", {
    async query(text: string) {
      return text.includes("legacy-opening")
        ? { rows: [{ id: "opening-operation" }] }
        : { rows: [{ coins: "130", cashable_coins: "70" }] };
    },
  } as unknown as import("../server/services/coinLedgerService").WalletReadPersistence);

  assert.deepEqual(postCutover, { coins: "130", cashableCoins: "70" });
});
