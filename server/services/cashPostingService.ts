import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const MIN_POSTGRES_BIGINT = -9_223_372_036_854_775_808n;
const NEGATIVE_CASH_BUCKETS = new Set(["settlement_clearing", "opening_equity"]);

export class CashPostingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CashPostingError";
  }
}

export type CashPosting = {
  cashAccountId: string;
  amountMinorUnits: bigint;
};

export type CashPostingInput = {
  actorScope: "member" | "site_owner" | "agent" | "system";
  actorUserId?: string;
  actorAgentId?: string;
  operationType: string;
  idempotencyKey: string;
  currencyCode: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  postings: CashPosting[];
};

export type CashPostingPersistence = {
  connect: () => Promise<PoolClient>;
};

export type CashAccountDescriptor =
  | {
      ownerType: "member";
      ownerUserId: string;
      bucket: "recipient_earnings" | "withdrawable_balance" | "payout_reserved";
      currencyCode: string;
    }
  | {
      ownerType: "site_owner";
      ownerUserId: string;
      bucket: "site_profit" | "payout_reserved";
      currencyCode: string;
    }
  | {
      ownerType: "hosting_owner";
      ownerReference: string;
      bucket: "hosting_profit" | "payout_reserved";
      currencyCode: string;
    }
  | {
      ownerType: "agent";
      ownerAgentId: string;
      bucket: "sales_reward" | "payout_reserved";
      currencyCode: string;
    }
  | {
      ownerType: "system";
      bucket: "settlement_clearing" | "opening_equity" | "platform_cash_asset";
      currencyCode: string;
    };

export type CashAccountProvisioningPersistence = Pick<typeof dbPool, "query">;

type CashAccountRow = {
  id: string;
  owner_type: "member" | "site_owner" | "hosting_owner" | "agent" | "system";
  owner_user_id: string | null;
  owner_agent_id: string | null;
  owner_reference: string | null;
  bucket: string;
  currency_code: string;
  balance_minor_units: string;
};

type ExistingCashOperationRow = {
  id: string;
  operation_type: string;
  request_fingerprint: string;
  reference_type: string | null;
  reference_id: string | null;
  currency_code: string;
};

const defaultPersistence: CashPostingPersistence = {
  connect: () => dbPool.connect(),
};

const normalizeCashAccount = (input: CashAccountDescriptor) => {
  const currencyCode = typeof input?.currencyCode === "string"
    ? input.currencyCode.trim().toUpperCase()
    : "";
  const ownerUserId = "ownerUserId" in input && typeof input.ownerUserId === "string"
    ? input.ownerUserId.trim() || null
    : null;
  const ownerAgentId = "ownerAgentId" in input && typeof input.ownerAgentId === "string"
    ? input.ownerAgentId.trim().toLowerCase() || null
    : null;
  const ownerReference = "ownerReference" in input && typeof input.ownerReference === "string"
    ? input.ownerReference.trim().toLowerCase() || null
    : null;
  const allowedBuckets: Record<CashAccountDescriptor["ownerType"], readonly string[]> = {
    member: ["recipient_earnings", "withdrawable_balance", "payout_reserved"],
    site_owner: ["site_profit", "payout_reserved"],
    hosting_owner: ["hosting_profit", "payout_reserved"],
    agent: ["sales_reward", "payout_reserved"],
    system: ["settlement_clearing", "opening_equity", "platform_cash_asset"],
  };
  const validIdentity =
    (input.ownerType === "member" || input.ownerType === "site_owner")
      ? ownerUserId !== null && ownerUserId.length <= 255 && ownerAgentId === null && ownerReference === null
      : input.ownerType === "agent"
        ? ownerAgentId !== null && UUID_PATTERN.test(ownerAgentId) && ownerUserId === null && ownerReference === null
        : input.ownerType === "hosting_owner"
          ? ownerReference !== null &&
            /^[a-z0-9][a-z0-9._-]{2,63}$/.test(ownerReference) &&
            ownerUserId === null &&
            ownerAgentId === null
          : input.ownerType === "system" &&
            ownerUserId === null &&
            ownerAgentId === null &&
            ownerReference === null;

  if (
    !validIdentity ||
    !allowedBuckets[input.ownerType]?.includes(input.bucket) ||
    !/^[A-Z]{3}$/.test(currencyCode)
  ) {
    throw new CashPostingError("INVALID_ACCOUNT", "بيانات حساب دفتر النقد غير صالحة");
  }

  return {
    ownerType: input.ownerType,
    ownerUserId,
    ownerAgentId,
    ownerReference,
    bucket: input.bucket,
    currencyCode,
  };
};

export const ensureCashAccount = async (
  rawInput: CashAccountDescriptor,
  persistence: CashAccountProvisioningPersistence = dbPool,
) => {
  const input = normalizeCashAccount(rawInput);
  const inserted = await persistence.query<{ id: string }>(
    `INSERT INTO "cash_accounts"
       ("owner_type", "owner_user_id", "owner_agent_id", "owner_reference", "bucket", "currency_code")
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING "id"`,
    [
      input.ownerType,
      input.ownerUserId,
      input.ownerAgentId,
      input.ownerReference,
      input.bucket,
      input.currencyCode,
    ],
  );
  if (inserted.rows[0]) {
    return { cashAccountId: inserted.rows[0].id, created: true };
  }

  const existing = await persistence.query<{ id: string }>(
    `SELECT "id" FROM "cash_accounts"
     WHERE "owner_type" = $1
       AND "owner_user_id" IS NOT DISTINCT FROM $2
       AND "owner_agent_id" IS NOT DISTINCT FROM $3
       AND "owner_reference" IS NOT DISTINCT FROM $4
       AND "bucket" = $5
       AND "currency_code" = $6`,
    [
      input.ownerType,
      input.ownerUserId,
      input.ownerAgentId,
      input.ownerReference,
      input.bucket,
      input.currencyCode,
    ],
  );
  if (!existing.rows[0]) {
    throw new CashPostingError("ACCOUNT_PROVISIONING_CONFLICT", "تعذر العثور على الحساب بعد محاولة إنشائه");
  }
  return { cashAccountId: existing.rows[0].id, created: false };
};

const normalizeInput = (input: CashPostingInput) => {
  const actorUserId = typeof input?.actorUserId === "string" ? input.actorUserId.trim() || null : null;
  const actorAgentId = typeof input?.actorAgentId === "string"
    ? input.actorAgentId.trim().toLowerCase() || null
    : null;
  const operationType = typeof input?.operationType === "string" ? input.operationType.trim() : "";
  const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const currencyCode = typeof input?.currencyCode === "string"
    ? input.currencyCode.trim().toUpperCase()
    : "";
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
    !/^[A-Z]{3}$/.test(currencyCode) ||
    (referenceType !== null && referenceType.length > 40) ||
    (referenceId !== null && referenceId.length > 255) ||
    !Array.isArray(input.postings) ||
    input.postings.length < 2 ||
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    throw new CashPostingError("INVALID_OPERATION", "بيانات العملية النقدية غير صالحة");
  }

  const postings = input.postings.map((posting) => {
    if (
      typeof posting !== "object" ||
      posting === null ||
      typeof posting.cashAccountId !== "string" ||
      !UUID_PATTERN.test(posting.cashAccountId) ||
      typeof posting.amountMinorUnits !== "bigint" ||
      posting.amountMinorUnits === 0n ||
      posting.amountMinorUnits < MIN_POSTGRES_BIGINT ||
      posting.amountMinorUnits > MAX_POSTGRES_BIGINT
    ) {
      throw new CashPostingError("INVALID_POSTING", "قيد الحساب النقدي غير صالح");
    }
    return { ...posting, cashAccountId: posting.cashAccountId.toLowerCase() };
  }).sort((left, right) => left.cashAccountId.localeCompare(right.cashAccountId));

  if (new Set(postings.map((posting) => posting.cashAccountId)).size !== postings.length) {
    throw new CashPostingError("DUPLICATE_ACCOUNT", "لا يمكن تكرار الحساب في العملية نفسها");
  }
  if (postings.reduce((sum, posting) => sum + posting.amountMinorUnits, 0n) !== 0n) {
    throw new CashPostingError("UNBALANCED_OPERATION", "قيود العملية النقدية غير متوازنة");
  }

  let metadataJson: string;
  try {
    metadataJson = JSON.stringify(metadata);
  } catch {
    throw new CashPostingError("INVALID_METADATA", "بيانات العملية الوصفية غير صالحة");
  }
  if (metadataJson === undefined) {
    throw new CashPostingError("INVALID_METADATA", "بيانات العملية الوصفية غير صالحة");
  }

  const normalized = {
    actorScope: input.actorScope,
    actorUserId,
    actorAgentId,
    operationType,
    idempotencyKey,
    currencyCode,
    referenceType,
    referenceId,
    metadataJson,
    postings,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      actorScope: input.actorScope,
      actorUserId,
      actorAgentId,
      operationType,
      currencyCode,
      referenceType,
      referenceId,
      postings: postings.map(({ cashAccountId, amountMinorUnits }) => ({
        cashAccountId,
        amountMinorUnits: amountMinorUnits.toString(),
      })),
      metadata: JSON.parse(metadataJson),
    }))
    .digest("hex");

  return { ...normalized, fingerprint };
};

const readExistingOperation = async (
  client: PoolClient,
  input: ReturnType<typeof normalizeInput>,
): Promise<ExistingCashOperationRow | undefined> => {
  const result = await client.query<ExistingCashOperationRow>(
    `SELECT "id", "operation_type", "request_fingerprint", "reference_type", "reference_id", "currency_code"
     FROM "cash_operations"
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
  operation: ExistingCashOperationRow,
  input: ReturnType<typeof normalizeInput>,
) => {
  if (
    operation.operation_type !== input.operationType ||
    operation.request_fingerprint !== input.fingerprint ||
    operation.reference_type !== input.referenceType ||
    operation.reference_id !== input.referenceId ||
    operation.currency_code !== input.currencyCode
  ) {
    throw new CashPostingError("IDEMPOTENCY_CONFLICT", "مفتاح العملية مستخدم بطلب مختلف");
  }
  return { operationId: operation.id, replayed: true };
};

export const postCashOperation = async (
  rawInput: CashPostingInput,
  persistence: CashPostingPersistence = defaultPersistence,
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

    const accountResult = await client.query<CashAccountRow>(
      `SELECT "id", "owner_type", "owner_user_id", "owner_agent_id", "owner_reference",
              "bucket", "currency_code", "balance_minor_units"::text AS "balance_minor_units"
       FROM "cash_accounts"
       WHERE "id" = ANY($1::uuid[])
       ORDER BY "id"
       FOR UPDATE`,
      [input.postings.map((posting) => posting.cashAccountId)],
    );
    if (accountResult.rows.length !== input.postings.length) {
      throw new CashPostingError("ACCOUNT_NOT_FOUND", "أحد الحسابات النقدية غير موجود");
    }

    const accounts = new Map(accountResult.rows.map((account) => [account.id, account]));
    for (const posting of input.postings) {
      const account = accounts.get(posting.cashAccountId);
      if (!account || !/^-?\d+$/.test(account.balance_minor_units)) {
        throw new CashPostingError("LEDGER_INCONSISTENT", "رصيد الحساب النقدي غير صالح");
      }
      if (account.currency_code !== input.currencyCode) {
        throw new CashPostingError("CURRENCY_MISMATCH", "لا يمكن خلط العملات في عملية واحدة");
      }
      const ownerMatches =
        input.actorScope === "system" ||
        account.owner_type === "system" ||
        (input.actorScope === "member" &&
          account.owner_type === "member" &&
          account.owner_user_id === input.actorUserId) ||
        (input.actorScope === "site_owner" &&
          account.owner_type === "site_owner" &&
          account.owner_user_id === input.actorUserId) ||
        (input.actorScope === "agent" &&
          account.owner_type === "agent" &&
          account.owner_agent_id === input.actorAgentId);
      if (!ownerMatches) {
        throw new CashPostingError("ACTOR_ACCOUNT_MISMATCH", "لا يملك المنفذ صلاحية استخدام أحد الحسابات");
      }

      const nextBalance = BigInt(account.balance_minor_units) + posting.amountMinorUnits;
      const mayBeNegative =
        account.owner_type === "system" && NEGATIVE_CASH_BUCKETS.has(account.bucket);
      if (
        nextBalance < MIN_POSTGRES_BIGINT ||
        nextBalance > MAX_POSTGRES_BIGINT ||
        (!mayBeNegative && nextBalance < 0n)
      ) {
        throw new CashPostingError("INSUFFICIENT_FUNDS", "رصيد نقدي غير كافٍ");
      }
    }

    const operationResult = await client.query<{ id: string }>(
      `INSERT INTO "cash_operations"
        ("actor_scope", "actor_user_id", "actor_agent_id", "operation_type",
         "idempotency_key", "request_fingerprint", "currency_code",
         "reference_type", "reference_id", "metadata")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        input.actorScope,
        input.actorUserId,
        input.actorAgentId,
        input.operationType,
        input.idempotencyKey,
        input.fingerprint,
        input.currencyCode,
        input.referenceType,
        input.referenceId,
        input.metadataJson,
      ],
    );
    const operationId = operationResult.rows[0]?.id;
    if (!operationId) {
      const conflictedOperation = await readExistingOperation(client, input);
      if (!conflictedOperation) {
        throw new CashPostingError("IDEMPOTENCY_CONFLICT", "تعذر تثبيت العملية النقدية");
      }
      const replay = replayExistingOperation(conflictedOperation, input);
      await client.query("COMMIT");
      transactionStarted = false;
      return replay;
    }

    for (const posting of input.postings) {
      const account = accounts.get(posting.cashAccountId);
      if (!account) throw new CashPostingError("LEDGER_INCONSISTENT", "الحساب النقدي غير موجود");
      const nextBalance = BigInt(account.balance_minor_units) + posting.amountMinorUnits;
      const mayBeNegative =
        account.owner_type === "system" && NEGATIVE_CASH_BUCKETS.has(account.bucket);
      const updated = await client.query(
        `UPDATE "cash_accounts"
         SET "balance_minor_units" = "balance_minor_units" + $1::bigint, "updated_at" = now()
         WHERE "id" = $2
           AND ($3::boolean = true OR "balance_minor_units" + $1::bigint >= 0)
         RETURNING "id"`,
        [posting.amountMinorUnits.toString(), posting.cashAccountId, mayBeNegative],
      );
      if (updated.rows.length !== 1) {
        throw new CashPostingError("INSUFFICIENT_FUNDS", "تعذر تحديث رصيد الحساب النقدي");
      }
      await client.query(
        `INSERT INTO "cash_entries"
          ("operation_id", "cash_account_id", "currency_code", "amount_minor_units")
         VALUES ($1, $2, $3, $4::bigint)`,
        [
          operationId,
          posting.cashAccountId,
          input.currencyCode,
          posting.amountMinorUnits.toString(),
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
          "cash operation failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
