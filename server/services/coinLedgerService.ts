import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";
import { addUserExp } from "./userLevelService";
import { calculateGiftCommissionCoins, getGiftCommissionRateBasisPoints } from "./giftCommissionService";

const LEGACY_OPENING_KEY = "legacy-opening-v1";
const MAX_GIFT_QUANTITY = 1_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export class GiftLedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GiftLedgerError";
  }
}

export type GiftSettlement = {
  totalCoins: bigint;
  commissionCoins: bigint;
  legacyDebitCoins: bigint;
  cashableDebitCoins: bigint;
  legacyCommissionCoins: bigint;
  cashableCommissionCoins: bigint;
  legacyRecipientCreditCoins: bigint;
  cashableRecipientCreditCoins: bigint;
};

const isValidCommissionRate = (rateBasisPoints: number) =>
  Number.isSafeInteger(rateBasisPoints) && rateBasisPoints >= 0 && rateBasisPoints <= 10_000;

export const planGiftSettlement = (
  totalCoins: bigint,
  legacyBalance: bigint,
  cashableBalance: bigint,
  rateBasisPoints: number,
): GiftSettlement => {
  if (
    totalCoins <= 0n ||
    legacyBalance < 0n ||
    cashableBalance < 0n ||
    !isValidCommissionRate(rateBasisPoints)
  ) {
    throw new GiftLedgerError("INVALID_GIFT", "بيانات الهدية غير صالحة");
  }

  if (legacyBalance + cashableBalance < totalCoins) {
    throw new GiftLedgerError("INSUFFICIENT_FUNDS", "رصيد غير كافٍ");
  }

  const legacyDebitCoins = legacyBalance < totalCoins ? legacyBalance : totalCoins;
  const cashableDebitCoins = totalCoins - legacyDebitCoins;
  const commissionCoins = calculateGiftCommissionCoins(totalCoins, rateBasisPoints);
  const legacyCommissionCoins = (commissionCoins * legacyDebitCoins) / totalCoins;
  const cashableCommissionCoins = commissionCoins - legacyCommissionCoins;

  return {
    totalCoins,
    commissionCoins,
    legacyDebitCoins,
    cashableDebitCoins,
    legacyCommissionCoins,
    cashableCommissionCoins,
    legacyRecipientCreditCoins: legacyDebitCoins - legacyCommissionCoins,
    cashableRecipientCreditCoins: cashableDebitCoins - cashableCommissionCoins,
  };
};

export type GiftLedgerPersistence = {
  connect: () => Promise<PoolClient>;
  awardExperience: typeof addUserExp;
};

export type SendGiftInput = {
  senderUserId: string;
  receiverUserId: string;
  giftId: string;
  quantity: number;
  idempotencyKey: string;
};

export type SendGiftResult = {
  id: string;
  totalCoins: number;
  newBalance: string;
  createdAt: Date | string;
  replayed: boolean;
};

export type WalletSummary = {
  coins: string;
  cashableCoins: string;
};

export type WalletReadPersistence = Pick<typeof dbPool, "query">;

type WalletBalanceRow = {
  id: string;
  user_id: string | null;
  bucket: string;
  balance_coins: string;
};

type WalletOperationRow = {
  id: string;
  request_fingerprint: string;
  reference_id: string | null;
  metadata: unknown;
};

const defaultPersistence: GiftLedgerPersistence = {
  connect: () => dbPool.connect(),
  awardExperience: addUserExp,
};

export const getWalletSummary = async (
  userId: string,
  persistence: WalletReadPersistence = dbPool,
): Promise<WalletSummary> => {
  const opening = await persistence.query<{ id: string }>(
    `SELECT "id"
     FROM "wallet_operations"
     WHERE "actor_scope" = 'system'
       AND "operation_type" = 'legacy_opening'
       AND "idempotency_key" = $1
     LIMIT 1`,
    [LEGACY_OPENING_KEY],
  );
  if (opening.rows.length === 0) {
    const legacy = await persistence.query<{ coins: string }>(
      `SELECT COALESCE("coins", 0)::text AS "coins"
       FROM "user_profiles"
       WHERE "user_id" = $1
       LIMIT 1`,
      [userId],
    );
    const coins = legacy.rows[0]?.coins ?? "0";
    if (!/^-?\d+$/.test(coins)) throw new Error("legacy coin balance is invalid");
    return { coins, cashableCoins: "0" };
  }

  const result = await persistence.query<{ coins: string; cashable_coins: string }>(
    `SELECT
       COALESCE(SUM("balance_coins") FILTER (WHERE "bucket" IN ('legacy_spendable', 'cashable_spendable')), 0)::text AS "coins",
       COALESCE(SUM("balance_coins") FILTER (WHERE "bucket" = 'cashable_spendable'), 0)::text AS "cashable_coins"
     FROM "wallet_balances"
     WHERE "account_type" = 'member'
       AND "user_id" = $1
       AND "bucket" IN ('legacy_spendable', 'cashable_spendable')`,
    [userId],
  );
  return {
    coins: result.rows[0]?.coins ?? "0",
    cashableCoins: result.rows[0]?.cashable_coins ?? "0",
  };
};

const giftRequestFingerprint = (input: SendGiftInput) =>
  createHash("sha256")
    .update(JSON.stringify({
      operationType: "gift",
      senderUserId: input.senderUserId,
      receiverUserId: input.receiverUserId,
      giftId: input.giftId,
      quantity: input.quantity,
    }))
    .digest("hex");

const validateGiftInput = (input: SendGiftInput) => {
  if (
    !input.senderUserId ||
    input.senderUserId.length > 255 ||
    !input.receiverUserId ||
    input.receiverUserId.length > 255 ||
    input.senderUserId === input.receiverUserId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.giftId) ||
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > MAX_GIFT_QUANTITY ||
    !input.idempotencyKey.trim() ||
    input.idempotencyKey.length > 128
  ) {
    throw new GiftLedgerError("INVALID_GIFT", "بيانات الهدية غير صالحة");
  }
};

const getExistingGiftResult = async (
  client: PoolClient,
  operation: WalletOperationRow,
  fingerprint: string,
  senderUserId: string,
): Promise<SendGiftResult> => {
  if (operation.request_fingerprint !== fingerprint) {
    throw new GiftLedgerError("IDEMPOTENCY_CONFLICT", "مفتاح العملية مستخدم بطلب مختلف");
  }
  if (!operation.reference_id) {
    throw new GiftLedgerError("LEDGER_INCONSISTENT", "تعذر التحقق من نتيجة العملية المالية");
  }

  const transaction = await client.query<{ id: string; total_coins: number; created_at: Date | string }>(
    `SELECT "id", "total_coins", "created_at"
     FROM "gift_transactions"
     WHERE "id" = $1 AND "sender_id" = $2
     LIMIT 1`,
    [operation.reference_id, senderUserId],
  );
  const row = transaction.rows[0];
  if (!row || !Number.isSafeInteger(Number(row.total_coins))) {
    throw new GiftLedgerError("LEDGER_INCONSISTENT", "تعذر التحقق من نتيجة العملية المالية");
  }

  const metadata = operation.metadata;
  const newBalance =
    typeof metadata === "object" &&
    metadata !== null &&
    "senderSpendableAfter" in metadata
      ? metadata.senderSpendableAfter
      : null;
  if (typeof newBalance !== "string" || !/^\d+$/.test(newBalance)) {
    throw new GiftLedgerError("LEDGER_INCONSISTENT", "تعذر التحقق من رصيد العملية المالية");
  }

  return {
    id: String(row.id),
    totalCoins: Number(row.total_coins),
    newBalance,
    createdAt: row.created_at,
    replayed: true,
  };
};

export const sendGiftFromWallet = async (
  input: SendGiftInput,
  persistence: GiftLedgerPersistence = defaultPersistence,
): Promise<SendGiftResult> => {
  validateGiftInput(input);
  const fingerprint = giftRequestFingerprint(input);
  const client = await persistence.connect();
  let transactionStarted = false;
  let committedResult: SendGiftResult | null = null;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      input.senderUserId,
      input.idempotencyKey,
    ]);

    const opening = await client.query<{ id: string }>(
      `SELECT "id"
       FROM "wallet_operations"
       WHERE "actor_scope" = 'system'
         AND "operation_type" = 'legacy_opening'
         AND "idempotency_key" = $1
       LIMIT 1`,
      [LEGACY_OPENING_KEY],
    );
    if (opening.rows.length === 0) {
      throw new GiftLedgerError("WALLET_CUTOVER_PENDING", "المحفظة الجديدة غير مفعّلة بعد");
    }

    const priorOperation = await client.query<WalletOperationRow>(
      `SELECT "id", "request_fingerprint", "reference_id", "metadata"
       FROM "wallet_operations"
       WHERE "actor_scope" = 'member'
         AND "actor_user_id" = $1
         AND "idempotency_key" = $2
       FOR UPDATE`,
      [input.senderUserId, input.idempotencyKey],
    );
    if (priorOperation.rows[0]) {
      committedResult = await getExistingGiftResult(
        client,
        priorOperation.rows[0],
        fingerprint,
        input.senderUserId,
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return committedResult;
    }

    const giftResult = await client.query<{ id: string; price: number }>(
      `SELECT "id", "price"
       FROM "gift_catalog"
       WHERE "id" = $1 AND "is_active" = true
       LIMIT 1`,
      [input.giftId],
    );
    const gift = giftResult.rows[0];
    if (!gift) throw new GiftLedgerError("GIFT_NOT_FOUND", "الهدية غير موجودة");
    if (!Number.isSafeInteger(gift.price) || gift.price <= 0) {
      throw new GiftLedgerError("INVALID_GIFT_PRICE", "سعر الهدية غير صالح");
    }
    const totalCoinsNumber = gift.price * input.quantity;
    if (!Number.isSafeInteger(totalCoinsNumber) || totalCoinsNumber > MAX_POSTGRES_INTEGER) {
      throw new GiftLedgerError("INVALID_GIFT", "قيمة الهدية تتجاوز الحد المسموح");
    }

    const commissionSetting = await client.query<{ value: unknown }>(
      `SELECT "value"
       FROM "wallet_settings"
       WHERE "key" = $1
       LIMIT 1`,
      ["gift_commission"],
    );
    const rateBasisPoints = getGiftCommissionRateBasisPoints(commissionSetting.rows[0]?.value);
    if (rateBasisPoints === null) {
      throw new GiftLedgerError("COMMISSION_NOT_CONFIGURED", "عمولة الهدايا غير مضبوطة");
    }

    await client.query(
      `INSERT INTO "wallet_balances" ("account_type", "user_id", "bucket")
       VALUES
         ('member', $1, 'legacy_spendable'),
         ('member', $1, 'cashable_spendable'),
         ('member', $2, 'legacy_spendable'),
         ('member', $2, 'cashable_spendable')
       ON CONFLICT ("user_id", "bucket")
         WHERE "account_type" = 'member' AND "user_id" IS NOT NULL
       DO NOTHING`,
      [input.senderUserId, input.receiverUserId],
    );
    await client.query(
      `INSERT INTO "wallet_balances" ("account_type", "bucket")
       VALUES ('system', 'platform_fee')
       ON CONFLICT ("bucket") WHERE "account_type" = 'system' DO NOTHING`,
    );

    const accountResult = await client.query<WalletBalanceRow>(
      `SELECT "id", "user_id", "bucket", "balance_coins"::text AS "balance_coins"
       FROM "wallet_balances"
       WHERE (
         "account_type" = 'member'
         AND "user_id" = ANY($1::varchar[])
         AND "bucket" IN ('legacy_spendable', 'cashable_spendable')
       ) OR (
         "account_type" = 'system' AND "bucket" = 'platform_fee'
       )
       ORDER BY "account_type", "user_id" NULLS FIRST, "bucket", "id"
       FOR UPDATE`,
      [[input.senderUserId, input.receiverUserId]],
    );
    const accountByKey = new Map(
      accountResult.rows.map((account) => [`${account.user_id ?? "system"}:${account.bucket}`, account]),
    );
    const senderLegacy = accountByKey.get(`${input.senderUserId}:legacy_spendable`);
    const senderCashable = accountByKey.get(`${input.senderUserId}:cashable_spendable`);
    const receiverLegacy = accountByKey.get(`${input.receiverUserId}:legacy_spendable`);
    const receiverCashable = accountByKey.get(`${input.receiverUserId}:cashable_spendable`);
    const platformFee = accountByKey.get("system:platform_fee");
    if (!senderLegacy || !senderCashable || !receiverLegacy || !receiverCashable || !platformFee) {
      throw new GiftLedgerError("LEDGER_INCONSISTENT", "حسابات المحفظة غير مكتملة");
    }

    const totalCoins = BigInt(totalCoinsNumber);
    const settlement = planGiftSettlement(
      totalCoins,
      BigInt(senderLegacy.balance_coins),
      BigInt(senderCashable.balance_coins),
      rateBasisPoints,
    );
    const senderSpendableAfter =
      BigInt(senderLegacy.balance_coins) +
      BigInt(senderCashable.balance_coins) -
      settlement.totalCoins;
    const transactionId = randomUUID();
    const metadata = {
      giftPriceCoins: gift.price,
      quantity: input.quantity,
      totalCoins: settlement.totalCoins.toString(),
      commissionRateBasisPoints: rateBasisPoints,
      commissionCoins: settlement.commissionCoins.toString(),
      legacyDebitCoins: settlement.legacyDebitCoins.toString(),
      cashableDebitCoins: settlement.cashableDebitCoins.toString(),
      legacyCommissionCoins: settlement.legacyCommissionCoins.toString(),
      cashableCommissionCoins: settlement.cashableCommissionCoins.toString(),
      senderSpendableAfter: senderSpendableAfter.toString(),
    };
    const operationResult = await client.query<{ id: string }>(
      `INSERT INTO "wallet_operations"
        ("actor_scope", "actor_user_id", "operation_type", "idempotency_key",
         "request_fingerprint", "reference_type", "reference_id", "metadata")
       VALUES ('member', $1, 'gift', $2, $3, 'gift_transaction', $4, $5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        input.senderUserId,
        input.idempotencyKey,
        fingerprint,
        transactionId,
        JSON.stringify(metadata),
      ],
    );
    const operationId = operationResult.rows[0]?.id;
    if (!operationId) {
      const conflictedOperation = await client.query<WalletOperationRow>(
        `SELECT "id", "request_fingerprint", "reference_id", "metadata"
         FROM "wallet_operations"
         WHERE "actor_scope" = 'member'
           AND "actor_user_id" = $1
           AND "idempotency_key" = $2
         FOR UPDATE`,
        [input.senderUserId, input.idempotencyKey],
      );
      if (!conflictedOperation.rows[0]) {
        throw new GiftLedgerError("IDEMPOTENCY_CONFLICT", "تعذر تثبيت العملية المالية");
      }
      committedResult = await getExistingGiftResult(
        client,
        conflictedOperation.rows[0],
        fingerprint,
        input.senderUserId,
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return committedResult;
    }

    const transaction = await client.query<{ created_at: Date | string }>(
      `INSERT INTO "gift_transactions"
        ("id", "gift_id", "sender_id", "receiver_id", "quantity", "total_coins")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "created_at"`,
      [
        transactionId,
        input.giftId,
        input.senderUserId,
        input.receiverUserId,
        input.quantity,
        totalCoinsNumber,
      ],
    );
    const createdAt = transaction.rows[0]?.created_at;
    if (!createdAt) throw new GiftLedgerError("LEDGER_INCONSISTENT", "تعذر تسجيل الهدية");

    const postings = [
      { account: senderLegacy, amount: -settlement.legacyDebitCoins },
      { account: senderCashable, amount: -settlement.cashableDebitCoins },
      { account: receiverLegacy, amount: settlement.legacyRecipientCreditCoins },
      { account: receiverCashable, amount: settlement.cashableRecipientCreditCoins },
      { account: platformFee, amount: settlement.commissionCoins },
    ].filter((posting) => posting.amount !== 0n);
    for (const posting of postings) {
      const amount = posting.amount.toString();
      const updated = await client.query(
        `UPDATE "wallet_balances"
         SET "balance_coins" = "balance_coins" + $1::bigint, "updated_at" = now()
         WHERE "id" = $2 AND "balance_coins" + $1::bigint >= 0
         RETURNING "id"`,
        [amount, posting.account.id],
      );
      if (updated.rows.length !== 1) {
        throw new GiftLedgerError("INSUFFICIENT_FUNDS", "رصيد غير كافٍ");
      }
      await client.query(
        `INSERT INTO "wallet_entries" ("operation_id", "wallet_balance_id", "amount")
         VALUES ($1, $2, $3::bigint)`,
        [operationId, posting.account.id, amount],
      );
    }
    await client.query(
      `UPDATE "user_profiles"
       SET "gifts_received_count" = COALESCE("gifts_received_count", 0) + $1
       WHERE "user_id" = $2`,
      [input.quantity, input.receiverUserId],
    );

    await client.query("COMMIT");
    transactionStarted = false;
    void persistence.awardExperience(input.senderUserId, totalCoinsNumber * 2, { source: "gift" }).catch((error) => {
      console.error("Failed to award sender experience for a committed gift", error);
    });
    void persistence.awardExperience(input.receiverUserId, totalCoinsNumber, { source: "gift" }).catch((error) => {
      console.error("Failed to award recipient experience for a committed gift", error);
    });
    return {
      id: transactionId,
      totalCoins: totalCoinsNumber,
      newBalance: senderSpendableAfter.toString(),
      createdAt,
      replayed: false,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "gift ledger operation failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
