import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";

const OPERATION_TYPE = "site_wallet_funding";
const REFERENCE_TYPE = "site_wallet_funding";
const ADVISORY_LOCK_NAMESPACE = 1_465_000_014;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MIN_POSTGRES_BIGINT = -9_223_372_036_854_775_808n;
const OWNER_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

export class SiteWalletFundingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SiteWalletFundingError";
  }
}

export type SiteWalletFundingInput = {
  hostingOwnerUsername: string;
  amountCoins: number;
  externalReference: string;
  idempotencyKey: string;
};

export type SiteWalletFundingResult = {
  id: string;
  amountCoins: number;
  externalReference: string;
  siteWalletBalance: string;
  createdAt: Date | string;
  replayed: boolean;
};

export type SiteWalletFundingPersistence = {
  connect: () => Promise<PoolClient>;
};

type WalletAccountRow = {
  id: string;
  bucket: string;
  balance_coins: string;
};

type ExistingOperationRow = {
  id: string;
  operation_type?: string;
  request_fingerprint: string;
  reference_id: string | null;
  metadata: unknown;
  created_at: Date | string;
};

const defaultPersistence: SiteWalletFundingPersistence = {
  connect: () => dbPool.connect(),
};

const normalizeFundingInput = (input: SiteWalletFundingInput) => {
  const username = typeof input?.hostingOwnerUsername === "string"
    ? input.hostingOwnerUsername.trim().toLowerCase()
    : "";
  const externalReference = typeof input?.externalReference === "string"
    ? input.externalReference.trim().toLowerCase()
    : "";
  const idempotencyKey = typeof input?.idempotencyKey === "string"
    ? input.idempotencyKey.trim()
    : "";

  if (
    !OWNER_USERNAME_PATTERN.test(username) ||
    !Number.isSafeInteger(input?.amountCoins) ||
    input.amountCoins <= 0 ||
    input.amountCoins > Number.MAX_SAFE_INTEGER ||
    !externalReference ||
    externalReference.length > 255 ||
    hasControlCharacters(externalReference) ||
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    hasControlCharacters(idempotencyKey)
  ) {
    throw new SiteWalletFundingError("INVALID_FUNDING", "بيانات التمويل غير صالحة");
  }

  return {
    hostingOwnerUsername: username,
    amountCoins: input.amountCoins,
    amount: BigInt(input.amountCoins),
    externalReference,
    idempotencyKey,
  };
};

const createRequestFingerprint = (input: ReturnType<typeof normalizeFundingInput>) =>
  createHash("sha256")
    .update(JSON.stringify({
      operationType: OPERATION_TYPE,
      hostingOwnerUsername: input.hostingOwnerUsername,
      amountCoins: input.amountCoins,
      externalReference: input.externalReference,
    }))
    .digest("hex");

const getReplayResult = (
  operation: ExistingOperationRow,
  fingerprint: string,
  input: ReturnType<typeof normalizeFundingInput>,
): SiteWalletFundingResult => {
  if (operation.request_fingerprint !== fingerprint) {
    throw new SiteWalletFundingError("IDEMPOTENCY_CONFLICT", "مفتاح العملية مستخدم بطلب مختلف");
  }

  const metadata = typeof operation.metadata === "string"
    ? JSON.parse(operation.metadata) as unknown
    : operation.metadata;
  if (
    operation.reference_id !== input.externalReference ||
    typeof metadata !== "object" ||
    metadata === null ||
    !("amountCoins" in metadata) ||
    !("siteWalletBalanceAfter" in metadata) ||
    metadata.amountCoins !== input.amountCoins.toString() ||
    typeof metadata.siteWalletBalanceAfter !== "string" ||
    !/^\d+$/.test(metadata.siteWalletBalanceAfter) ||
    !operation.created_at
  ) {
    throw new SiteWalletFundingError("LEDGER_INCONSISTENT", "تعذر التحقق من نتيجة عملية التمويل");
  }

  return {
    id: operation.id,
    amountCoins: input.amountCoins,
    externalReference: input.externalReference,
    siteWalletBalance: metadata.siteWalletBalanceAfter,
    createdAt: operation.created_at,
    replayed: true,
  };
};

const parseLedgerBalance = (value: string, bucket: string): bigint => {
  if (!/^-?\d+$/.test(value)) {
    throw new SiteWalletFundingError("LEDGER_INCONSISTENT", "رصيد المحفظة غير صالح");
  }
  const balance = BigInt(value);
  if (
    balance < MIN_POSTGRES_BIGINT ||
    balance > MAX_POSTGRES_BIGINT ||
    (bucket === "site_inventory" && balance < 0n)
  ) {
    throw new SiteWalletFundingError("LEDGER_INCONSISTENT", "حالة حساب المحفظة غير صالحة");
  }
  return balance;
};

export const fundSiteWallet = async (
  rawInput: SiteWalletFundingInput,
  persistence: SiteWalletFundingPersistence = defaultPersistence,
): Promise<SiteWalletFundingResult> => {
  const input = normalizeFundingInput(rawInput);
  const fingerprint = createRequestFingerprint(input);
  const client = await persistence.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      ADVISORY_LOCK_NAMESPACE,
      input.idempotencyKey,
    ]);

    const priorOperationResult = await client.query<ExistingOperationRow>(
      `SELECT "id", "operation_type", "request_fingerprint", "reference_id", "metadata", "created_at"
       FROM "wallet_operations"
       WHERE "actor_scope" = 'system' AND "idempotency_key" = $1
       FOR UPDATE`,
      [input.idempotencyKey],
    );
    const priorOperation = priorOperationResult.rows[0];
    if (priorOperation) {
      if (priorOperation.operation_type !== OPERATION_TYPE) {
        throw new SiteWalletFundingError("IDEMPOTENCY_CONFLICT", "مفتاح العملية مستخدم بطلب مختلف");
      }
      const replay = getReplayResult(priorOperation, fingerprint, input);
      await client.query("COMMIT");
      transactionStarted = false;
      return replay;
    }

    const accountResult = await client.query<WalletAccountRow>(
      `SELECT "id", "bucket", "balance_coins"::text AS "balance_coins"
       FROM "wallet_balances"
       WHERE "account_type" = 'system'
         AND "user_id" IS NULL
         AND "bucket" IN ('site_inventory', 'external_clearing')
       ORDER BY "bucket"
       FOR UPDATE`,
    );
    const accounts = new Map(accountResult.rows.map((account) => [account.bucket, account]));
    const siteInventory = accounts.get("site_inventory");
    const externalClearing = accounts.get("external_clearing");
    if (!siteInventory || !externalClearing || accountResult.rows.length !== 2) {
      throw new SiteWalletFundingError(
        "LEDGER_ACCOUNT_NOT_INITIALIZED",
        "حسابات تمويل الموقع غير مهيأة",
      );
    }

    const siteBalanceBefore = parseLedgerBalance(siteInventory.balance_coins, "site_inventory");
    const clearingBalanceBefore = parseLedgerBalance(externalClearing.balance_coins, "external_clearing");
    const siteBalanceAfter = siteBalanceBefore + input.amount;
    const clearingBalanceAfter = clearingBalanceBefore - input.amount;
    if (
      siteBalanceAfter > MAX_POSTGRES_BIGINT ||
      clearingBalanceAfter < MIN_POSTGRES_BIGINT
    ) {
      throw new SiteWalletFundingError("BALANCE_OVERFLOW", "قيمة التمويل تتجاوز سعة حساب المحفظة");
    }

    const metadata = {
      hostingOwnerUsername: input.hostingOwnerUsername,
      amountCoins: input.amount.toString(),
      externalReference: input.externalReference,
      siteWalletBalanceAfter: siteBalanceAfter.toString(),
    };
    const operationResult = await client.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO "wallet_operations"
        ("actor_scope", "operation_type", "idempotency_key", "request_fingerprint",
         "reference_type", "reference_id", "metadata")
       VALUES ('system', $1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id", "created_at"`,
      [
        OPERATION_TYPE,
        input.idempotencyKey,
        fingerprint,
        REFERENCE_TYPE,
        input.externalReference,
        JSON.stringify(metadata),
      ],
    );
    const operation = operationResult.rows[0];
    if (!operation) {
      const sameReference = await client.query<{ id: string }>(
        `SELECT "id"
         FROM "wallet_operations"
         WHERE "actor_scope" = 'system'
           AND "operation_type" = $1
           AND "reference_type" = $2
           AND lower("reference_id") = lower($3)
         LIMIT 1`,
        [OPERATION_TYPE, REFERENCE_TYPE, input.externalReference],
      );
      if (sameReference.rows.length > 0) {
        throw new SiteWalletFundingError(
          "DUPLICATE_EXTERNAL_REFERENCE",
          "مرجع التحويل مستخدم في عملية تمويل سابقة",
        );
      }
      throw new SiteWalletFundingError("IDEMPOTENCY_CONFLICT", "تعذر تثبيت عملية التمويل");
    }

    for (const [account, amount] of [
      [siteInventory, input.amount],
      [externalClearing, -input.amount],
    ] as const) {
      const updated = await client.query<{ id: string; balance_coins: string }>(
        `UPDATE "wallet_balances"
         SET "balance_coins" = "balance_coins" + $1::bigint, "updated_at" = now()
         WHERE "id" = $2
         RETURNING "id", "balance_coins"::text AS "balance_coins"`,
        [amount.toString(), account.id],
      );
      if (updated.rows.length !== 1) {
        throw new SiteWalletFundingError("LEDGER_INCONSISTENT", "تعذر تحديث حسابات المحفظة");
      }
      const expected = account.bucket === "site_inventory" ? siteBalanceAfter : clearingBalanceAfter;
      if (updated.rows[0].balance_coins !== expected.toString()) {
        throw new SiteWalletFundingError("LEDGER_INCONSISTENT", "رصيد حساب المحفظة بعد التحديث غير متطابق");
      }
      await client.query(
        `INSERT INTO "wallet_entries" ("operation_id", "wallet_balance_id", "amount")
         VALUES ($1, $2, $3::bigint)`,
        [operation.id, account.id, amount.toString()],
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return {
      id: operation.id,
      amountCoins: input.amountCoins,
      externalReference: input.externalReference,
      siteWalletBalance: siteBalanceAfter.toString(),
      createdAt: operation.created_at,
      replayed: false,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "site-wallet funding failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

export const getSiteWalletBalance = async (
  persistence: SiteWalletFundingPersistence = defaultPersistence,
): Promise<string> => {
  const client = await persistence.connect();
  try {
    const result = await client.query<{ balance_coins: string }>(
      `SELECT "balance_coins"::text AS "balance_coins"
       FROM "wallet_balances"
       WHERE "account_type" = 'system'
         AND "user_id" IS NULL
         AND "bucket" = 'site_inventory'`,
    );
    const account = result.rows[0];
    if (!account) {
      throw new SiteWalletFundingError(
        "LEDGER_ACCOUNT_NOT_INITIALIZED",
        "حساب مخزون الموقع غير مهيأ",
      );
    }

    return parseLedgerBalance(account.balance_coins, "site_inventory").toString();
  } finally {
    client.release();
  }
};
