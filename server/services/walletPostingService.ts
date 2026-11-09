import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MIN_POSTGRES_BIGINT = -9_223_372_036_854_775_808n;
const NEGATIVE_BALANCE_BUCKETS = new Set([
  "external_clearing",
  "legacy_opening_equity",
]);

export class WalletPostingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WalletPostingError";
  }
}

export type WalletPosting = {
  walletBalanceId: string;
  amount: bigint;
};

export type WalletPostingInput = {
  actorScope: "member" | "site_owner" | "agent" | "system";
  actorUserId?: string;
  actorAgentId?: string;
  operationType: string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  postings: WalletPosting[];
};

export type WalletPostingPersistence = {
  connect: () => Promise<PoolClient>;
};

type WalletAccountRow = {
  id: string;
  account_type: "member" | "site_owner" | "agent" | "system";
  user_id: string | null;
  agent_id: string | null;
  bucket: string;
  balance_coins: string;
};

type ExistingOperationRow = {
  id: string;
  operation_type: string;
  request_fingerprint: string;
  reference_type: string | null;
  reference_id: string | null;
};

const defaultPersistence: WalletPostingPersistence = {
  connect: () => dbPool.connect(),
};

const normalizeInput = (input: WalletPostingInput) => {
  const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const operationType = typeof input?.operationType === "string" ? input.operationType.trim() : "";
  const actorUserId = typeof input?.actorUserId === "string" ? input.actorUserId.trim() || null : null;
  const actorAgentId = typeof input?.actorAgentId === "string"
    ? input.actorAgentId.trim().toLowerCase() || null
    : null;
  const referenceType = typeof input?.referenceType === "string" ? input.referenceType.trim() || null : null;
  const referenceId = typeof input?.referenceId === "string" ? input.referenceId.trim() || null : null;
  const metadata = input?.metadata ?? {};

  if (
    !["member", "site_owner", "agent", "system"].includes(input?.actorScope) ||
    (["member", "site_owner"].includes(input.actorScope) && (!actorUserId || actorAgentId !== null)) ||
    (input.actorScope === "agent" && (!actorAgentId || actorUserId !== null)) ||
    (input.actorScope === "system" && (actorUserId !== null || actorAgentId !== null)) ||
    (actorUserId !== null && actorUserId.length > 255) ||
    (actorAgentId !== null && !UUID_PATTERN.test(actorAgentId)) ||
    !operationType ||
    operationType.length > 40 ||
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    (referenceType !== null && referenceType.length > 40) ||
    (referenceId !== null && referenceId.length > 255) ||
    !Array.isArray(input.postings) ||
    input.postings.length < 2 ||
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    throw new WalletPostingError("INVALID_OPERATION", "بيانات العملية المالية غير صالحة");
  }

  const postings = input.postings.map((posting) => {
    if (
      typeof posting !== "object" ||
      posting === null ||
      typeof posting.walletBalanceId !== "string" ||
      !UUID_PATTERN.test(posting.walletBalanceId) ||
      typeof posting.amount !== "bigint" ||
      posting.amount === 0n ||
      posting.amount < MIN_POSTGRES_BIGINT ||
      posting.amount > MAX_POSTGRES_BIGINT
    ) {
      throw new WalletPostingError("INVALID_POSTING", "قيد المحفظة غير صالح");
    }
    return { ...posting, walletBalanceId: posting.walletBalanceId.toLowerCase() };
  }).sort((left, right) => left.walletBalanceId.localeCompare(right.walletBalanceId));

  if (new Set(postings.map((posting) => posting.walletBalanceId)).size !== postings.length) {
    throw new WalletPostingError("DUPLICATE_ACCOUNT", "لا يمكن تكرار الحساب في العملية نفسها");
  }
  if (postings.reduce((sum, posting) => sum + posting.amount, 0n) !== 0n) {
    throw new WalletPostingError("UNBALANCED_OPERATION", "قيود العملية غير متوازنة");
  }

  let metadataJson: string;
  try {
    metadataJson = JSON.stringify(metadata);
  } catch {
    throw new WalletPostingError("INVALID_METADATA", "بيانات العملية الوصفية غير صالحة");
  }
  if (metadataJson === undefined) {
    throw new WalletPostingError("INVALID_METADATA", "بيانات العملية الوصفية غير صالحة");
  }

  const normalized = {
    actorScope: input.actorScope,
    actorUserId,
    actorAgentId,
    operationType,
    idempotencyKey,
    referenceType,
    referenceId,
    metadataJson,
    postings,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      operationType,
      actorScope: input.actorScope,
      actorUserId,
      actorAgentId,
      referenceType,
      referenceId,
      postings: postings.map(({ walletBalanceId, amount }) => ({
        walletBalanceId,
        amount: amount.toString(),
      })),
      metadata: JSON.parse(metadataJson),
    }))
    .digest("hex");

  return { ...normalized, fingerprint };
};

const readExistingOperation = async (
  client: PoolClient,
  input: ReturnType<typeof normalizeInput>,
): Promise<ExistingOperationRow | undefined> => {
  const result = await client.query<ExistingOperationRow>(
    `SELECT "id", "operation_type", "request_fingerprint", "reference_type", "reference_id"
     FROM "wallet_operations"
     WHERE "actor_scope" = $1
       AND "idempotency_key" = $2
       AND "actor_user_id" IS NOT DISTINCT FROM $3
       AND "actor_agent_id" IS NOT DISTINCT FROM $4
     FOR UPDATE`,
    [input.actorScope, input.idempotencyKey, input.actorUserId, input.actorAgentId],
  );
  return result.rows[0];
};

const replayExistingOperation = (
  operation: ExistingOperationRow,
  input: ReturnType<typeof normalizeInput>,
) => {
  if (
    operation.operation_type !== input.operationType ||
    operation.request_fingerprint !== input.fingerprint ||
    operation.reference_type !== input.referenceType ||
    operation.reference_id !== input.referenceId
  ) {
    throw new WalletPostingError("IDEMPOTENCY_CONFLICT", "مفتاح العملية مستخدم بطلب مختلف");
  }
  return { operationId: operation.id, replayed: true };
};

export const postWalletOperation = async (
  rawInput: WalletPostingInput,
  persistence: WalletPostingPersistence = defaultPersistence,
) => {
  const input = normalizeInput(rawInput);
  const client = await persistence.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const previousOperation = await readExistingOperation(client, input);
    if (previousOperation) {
      const replay = replayExistingOperation(previousOperation, input);
      await client.query("COMMIT");
      transactionStarted = false;
      return replay;
    }

    const accountResult = await client.query<WalletAccountRow>(
      `SELECT "id", "account_type", "user_id", "agent_id", "bucket",
             "balance_coins"::text AS "balance_coins"
      FROM "wallet_balances"
       WHERE "id" = ANY($1::uuid[])
       ORDER BY "id"
       FOR UPDATE`,
      [input.postings.map((posting) => posting.walletBalanceId)],
    );
    if (accountResult.rows.length !== input.postings.length) {
      throw new WalletPostingError("ACCOUNT_NOT_FOUND", "أحد حسابات العملية غير موجود");
    }

    const accounts = new Map(accountResult.rows.map((account) => [account.id, account]));
    for (const posting of input.postings) {
      const account = accounts.get(posting.walletBalanceId);
      if (!account || !/^-?\d+$/.test(account.balance_coins)) {
        throw new WalletPostingError("LEDGER_INCONSISTENT", "رصيد حساب المحفظة غير صالح");
      }
      const ownerMatches =
        input.actorScope === "system" ||
        account.account_type === "system" ||
        (input.actorScope === "member" &&
          account.account_type === "member" &&
          account.user_id === input.actorUserId) ||
        (input.actorScope === "site_owner" &&
          account.account_type === "site_owner" &&
          account.user_id === input.actorUserId) ||
        (input.actorScope === "agent" &&
          account.account_type === "agent" &&
          account.agent_id === input.actorAgentId);
      if (!ownerMatches) {
        throw new WalletPostingError("ACTOR_ACCOUNT_MISMATCH", "لا يملك المنفذ صلاحية استخدام أحد الحسابات");
      }
      const balance = BigInt(account.balance_coins);
      const nextBalance = balance + posting.amount;
      const requiresNonnegative =
        account.account_type !== "system" || !NEGATIVE_BALANCE_BUCKETS.has(account.bucket);
      if (
        nextBalance < MIN_POSTGRES_BIGINT ||
        nextBalance > MAX_POSTGRES_BIGINT ||
        (requiresNonnegative && nextBalance < 0n)
      ) {
        throw new WalletPostingError("INSUFFICIENT_FUNDS", "رصيد غير كافٍ");
      }
    }

    const operationResult = await client.query<{ id: string }>(
      `INSERT INTO "wallet_operations"
        ("actor_scope", "actor_user_id", "actor_agent_id", "operation_type",
         "idempotency_key", "request_fingerprint", "reference_type", "reference_id", "metadata")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        input.actorScope,
        input.actorUserId,
        input.actorAgentId,
        input.operationType,
        input.idempotencyKey,
        input.fingerprint,
        input.referenceType,
        input.referenceId,
        input.metadataJson,
      ],
    );
    const operationId = operationResult.rows[0]?.id;
    if (!operationId) {
      const conflictedOperation = await readExistingOperation(client, input);
      if (!conflictedOperation) {
        throw new WalletPostingError("IDEMPOTENCY_CONFLICT", "تعذر تثبيت العملية المالية");
      }
      const replay = replayExistingOperation(conflictedOperation, input);
      await client.query("COMMIT");
      transactionStarted = false;
      return replay;
    }

    for (const posting of input.postings) {
      const account = accounts.get(posting.walletBalanceId);
      if (!account) throw new WalletPostingError("LEDGER_INCONSISTENT", "حساب المحفظة غير موجود");
      const requiresNonnegative =
        account.account_type !== "system" || !NEGATIVE_BALANCE_BUCKETS.has(account.bucket);
      const updated = await client.query(
        `UPDATE "wallet_balances"
         SET "balance_coins" = "balance_coins" + $1::bigint, "updated_at" = now()
         WHERE "id" = $2
           AND ($3::boolean = false OR "balance_coins" + $1::bigint >= 0)
         RETURNING "id"`,
        [posting.amount.toString(), posting.walletBalanceId, requiresNonnegative],
      );
      if (updated.rows.length !== 1) {
        throw new WalletPostingError("INSUFFICIENT_FUNDS", "تعذر تحديث رصيد الحساب");
      }
      await client.query(
        `INSERT INTO "wallet_entries"
          ("operation_id", "wallet_balance_id", "amount")
         VALUES ($1, $2, $3::bigint)`,
        [
          operationId,
          posting.walletBalanceId,
          posting.amount.toString(),
        ],
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return { operationId, replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "wallet operation failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
