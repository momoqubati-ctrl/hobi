import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";

const OPERATION_TYPE = "member_coin_purchase_settlement";
const REFERENCE_TYPE = "member_coin_purchase";
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MemberCoinPurchaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MemberCoinPurchaseError";
  }
}

export type MemberCoinPurchasePersistence = {
  connect: () => Promise<PoolClient>;
};

type MemberPurchaseRow = {
  id: string;
  member_user_id: string;
  agent_id: string;
  coin_amount: string;
  price_minor_units: string;
  currency_code: string;
  payment_instructions_snapshot: string;
  payment_reference: string | null;
  proof_object_key: string | null;
  proof_uploaded_at: Date | string | null;
  receipt_expires_at: Date | string | null;
  status: string;
  settlement_operation_id: string | null;
  reviewed_by_agent_id: string | null;
  rejection_reason: string | null;
};

type PurchaseBalanceRow = {
  id: string;
  account_type: "agent" | "member";
  user_id: string | null;
  agent_id: string | null;
  bucket: string;
  balance_coins: string;
};

const defaultPersistence: MemberCoinPurchasePersistence = {
  connect: () => dbPool.connect(),
};

const hashRequest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const isConstraintViolation = (error: unknown, constraint: string) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint,
  );

const parseLedgerBalance = (value: string) => {
  if (!/^\d+$/.test(value)) {
    throw new MemberCoinPurchaseError("LEDGER_INCONSISTENT", "رصيد المحفظة غير صالح");
  }
  const balance = BigInt(value);
  if (balance > MAX_POSTGRES_BIGINT) {
    throw new MemberCoinPurchaseError("LEDGER_INCONSISTENT", "رصيد المحفظة يتجاوز الحد المسموح");
  }
  return balance;
};

const hasInvalidControl = (value: string) => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
};

const validateMemberPurchaseInput = (input: {
  memberUserId: string;
  agentId: string;
  packageId: string;
  idempotencyKey: string;
}) => {
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (
    typeof input.memberUserId !== "string" ||
    input.memberUserId.trim().length < 1 ||
    input.memberUserId.length > 255 ||
    hasInvalidControl(input.memberUserId) ||
    !UUID_PATTERN.test(input.agentId) ||
    !UUID_PATTERN.test(input.packageId) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 128 ||
    hasInvalidControl(idempotencyKey)
  ) {
    throw new MemberCoinPurchaseError("INVALID_MEMBER_PURCHASE", "بيانات طلب شراء العملات غير صالحة");
  }
  return { ...input, idempotencyKey };
};

export const createMemberCoinPurchase = async (
  rawInput: {
    memberUserId: string;
    agentId: string;
    packageId: string;
    idempotencyKey: string;
  },
  persistence: Pick<typeof dbPool, "query"> = dbPool,
) => {
  const input = validateMemberPurchaseInput(rawInput);
  const fingerprint = hashRequest({
    operationType: "member_coin_purchase",
    memberUserId: input.memberUserId,
    agentId: input.agentId,
    packageId: input.packageId,
  });
  const inserted = await persistence.query<{
    id: string;
    member_user_id: string;
    agent_id: string;
    coin_amount: string;
    price_minor_units: string;
    currency_code: string;
    payment_instructions_snapshot: string;
    status: string;
  }>(
    `INSERT INTO "member_coin_purchases"
      ("member_user_id", "agent_id", "package_id", "coin_amount", "price_minor_units",
       "currency_code", "payment_instructions_snapshot", "idempotency_key", "request_fingerprint")
     SELECT $1, packages."agent_id", packages."id", packages."coin_amount",
            packages."price_minor_units", packages."currency_code",
            packages."payment_instructions", $4, $5
     FROM "wallet_agent_packages" packages
     JOIN "wallet_agents" agents ON agents."id" = packages."agent_id" AND agents."status" = 'active'
     JOIN "users" members ON members."id" = $1 AND members."status" = 'active' AND members."role" <> 'guest'
     WHERE packages."id" = $3 AND packages."agent_id" = $2 AND packages."is_active" = true
     ON CONFLICT ("member_user_id", "idempotency_key") DO NOTHING
     RETURNING "id", "member_user_id", "agent_id", "coin_amount"::text AS "coin_amount",
               "price_minor_units"::text AS "price_minor_units", "currency_code",
               "payment_instructions_snapshot", "status"`,
    [input.memberUserId, input.agentId, input.packageId, input.idempotencyKey, fingerprint],
  );
  const row = inserted.rows[0];
  if (row) return { ...row, replayed: false };

  const existing = await persistence.query<{
    id: string;
    member_user_id: string;
    agent_id: string;
    coin_amount: string;
    price_minor_units: string;
    currency_code: string;
    payment_instructions_snapshot: string;
    request_fingerprint: string;
    status: string;
  }>(
    `SELECT "id", "member_user_id", "agent_id", "coin_amount"::text AS "coin_amount",
            "price_minor_units"::text AS "price_minor_units", "currency_code",
            "payment_instructions_snapshot", "request_fingerprint", "status"
     FROM "member_coin_purchases"
     WHERE "member_user_id" = $1 AND "idempotency_key" = $2
     LIMIT 1`,
    [input.memberUserId, input.idempotencyKey],
  );
  const prior = existing.rows[0];
  if (prior) {
    if (prior.request_fingerprint !== fingerprint) {
      throw new MemberCoinPurchaseError("IDEMPOTENCY_CONFLICT", "مفتاح الطلب مستخدم لعملية مختلفة");
    }
    return { ...prior, replayed: true };
  }
  throw new MemberCoinPurchaseError("PACKAGE_UNAVAILABLE", "الباقة غير متاحة للشراء");
};

export const submitMemberCoinPurchasePayment = async (
  input: {
    purchaseId: string;
    memberUserId: string;
    paymentReference: string;
    proofObjectKey: string;
  },
  persistence: MemberCoinPurchasePersistence = defaultPersistence,
) => {
  const paymentReference = typeof input.paymentReference === "string"
    ? input.paymentReference.trim()
    : "";
  if (
    !UUID_PATTERN.test(input.purchaseId) ||
    typeof input.memberUserId !== "string" ||
    input.memberUserId.trim().length < 1 ||
    input.memberUserId.length > 255 ||
    hasInvalidControl(input.memberUserId) ||
    paymentReference.length < 1 ||
    paymentReference.length > 255 ||
    hasInvalidControl(paymentReference) ||
    typeof input.proofObjectKey !== "string" ||
    !/^wallet-proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i.test(input.proofObjectKey)
  ) {
    throw new MemberCoinPurchaseError("INVALID_MEMBER_PAYMENT", "بيانات إثبات الدفع غير صالحة");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query<MemberPurchaseRow>(
      `SELECT "id", "member_user_id", "agent_id", "coin_amount"::text AS "coin_amount",
              "price_minor_units"::text AS "price_minor_units", "currency_code",
              "payment_instructions_snapshot", "payment_reference", "proof_object_key",
              "proof_uploaded_at", "receipt_expires_at", "status",
              "settlement_operation_id", "reviewed_by_agent_id", "rejection_reason"
       FROM "member_coin_purchases"
       WHERE "id" = $1 AND "member_user_id" = $2
       FOR UPDATE`,
      [input.purchaseId, input.memberUserId],
    );
    const purchase = result.rows[0];
    if (!purchase) throw new MemberCoinPurchaseError("MEMBER_PURCHASE_NOT_FOUND", "طلب الشراء غير موجود");
    if (
      purchase.status === "submitted" &&
      purchase.payment_reference?.trim().toLowerCase() === paymentReference.toLowerCase()
    ) {
      await client.query("COMMIT");
      transactionStarted = false;
      return { id: purchase.id, status: purchase.status, replayed: true };
    }
    if (purchase.status !== "awaiting_payment") {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_NOT_PAYABLE", "لا يمكن إرسال إثبات لهذا الطلب");
    }

    const updated = await client.query(
      `UPDATE "member_coin_purchases"
       SET "payment_reference" = $1, "proof_object_key" = $2,
           "proof_uploaded_at" = now(), "receipt_expires_at" = now() + interval '30 days',
           "status" = 'submitted', "updated_at" = now()
       WHERE "id" = $3 AND "member_user_id" = $4 AND "status" = 'awaiting_payment'`,
      [paymentReference, input.proofObjectKey, purchase.id, input.memberUserId],
    );
    if (updated.rowCount !== 1) {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_ALREADY_REVIEWED", "سبق التعامل مع طلب الشراء");
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { id: purchase.id, status: "submitted", replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "member payment submission rollback failed");
      }
    }
    if (isConstraintViolation(error, "member_coin_purchases_agent_payment_reference_idx")) {
      throw new MemberCoinPurchaseError("DUPLICATE_PAYMENT_REFERENCE", "سبق استخدام مرجع التحويل مع هذا الوكيل");
    }
    throw error;
  } finally {
    client.release();
  }
};

export const rejectMemberCoinPurchase = async (
  input: { purchaseId: string; agentId: string; reason: string },
  persistence: MemberCoinPurchasePersistence = defaultPersistence,
) => {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (
    !UUID_PATTERN.test(input.purchaseId) ||
    !UUID_PATTERN.test(input.agentId) ||
    reason.length < 2 ||
    reason.length > 500 ||
    hasInvalidControl(reason)
  ) {
    throw new MemberCoinPurchaseError("INVALID_MEMBER_PURCHASE", "بيانات رفض طلب الشراء غير صالحة");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query<MemberPurchaseRow>(
      `SELECT purchases."id", purchases."member_user_id", purchases."agent_id",
              purchases."coin_amount"::text AS "coin_amount",
              purchases."price_minor_units"::text AS "price_minor_units",
              purchases."currency_code", purchases."payment_instructions_snapshot",
              purchases."payment_reference", purchases."proof_object_key",
              purchases."proof_uploaded_at", purchases."receipt_expires_at",
              purchases."status", purchases."settlement_operation_id",
              purchases."reviewed_by_agent_id", purchases."rejection_reason"
       FROM "member_coin_purchases" purchases
       JOIN "wallet_agents" agents
         ON agents."id" = purchases."agent_id" AND agents."status" = 'active'
       WHERE purchases."id" = $1 AND purchases."agent_id" = $2
       FOR UPDATE OF purchases, agents`,
      [input.purchaseId, input.agentId],
    );
    const purchase = result.rows[0];
    if (!purchase) {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_NOT_FOUND", "طلب الشراء غير موجود");
    }
    if (
      purchase.status === "rejected" &&
      purchase.reviewed_by_agent_id === input.agentId &&
      purchase.rejection_reason === reason
    ) {
      await client.query("COMMIT");
      transactionStarted = false;
      return { id: purchase.id, status: "rejected", replayed: true };
    }
    if (purchase.status !== "submitted") {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_ALREADY_REVIEWED", "سبق التعامل مع طلب الشراء");
    }

    const updated = await client.query(
      `UPDATE "member_coin_purchases"
       SET "status" = 'rejected', "reviewed_by_agent_id" = $1,
           "reviewed_at" = now(), "rejection_reason" = $2,
           "receipt_expires_at" = "proof_uploaded_at" + interval '30 days',
           "updated_at" = now()
       WHERE "id" = $3 AND "agent_id" = $1 AND "status" = 'submitted'`,
      [input.agentId, reason, purchase.id],
    );
    if (updated.rowCount !== 1) {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_ALREADY_REVIEWED", "سبق التعامل مع طلب الشراء");
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { id: purchase.id, status: "rejected", replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "member purchase rejection rollback failed");
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

export const approveMemberCoinPurchase = async (
  input: { purchaseId: string; agentId: string; paymentVerified: boolean },
  persistence: MemberCoinPurchasePersistence = defaultPersistence,
) => {
  if (
    !UUID_PATTERN.test(input.purchaseId) ||
    !UUID_PATTERN.test(input.agentId) ||
    input.paymentVerified !== true
  ) {
    throw new MemberCoinPurchaseError("PAYMENT_NOT_VERIFIED", "يلزم تأكيد التحقق من التحويل قبل اعتماد الشراء");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      REFERENCE_TYPE,
      input.purchaseId,
    ]);

    const purchaseResult = await client.query<MemberPurchaseRow>(
      `SELECT purchases."id", purchases."member_user_id", purchases."agent_id",
              purchases."coin_amount"::text AS "coin_amount",
              purchases."price_minor_units"::text AS "price_minor_units",
              purchases."currency_code", purchases."payment_instructions_snapshot",
              purchases."payment_reference", purchases."proof_object_key",
              purchases."proof_uploaded_at", purchases."receipt_expires_at",
              purchases."status", purchases."settlement_operation_id",
              purchases."reviewed_by_agent_id", purchases."rejection_reason"
       FROM "member_coin_purchases" purchases
       JOIN "wallet_agents" agents
         ON agents."id" = purchases."agent_id" AND agents."status" = 'active'
       WHERE purchases."id" = $1 AND purchases."agent_id" = $2
       FOR UPDATE OF purchases, agents`,
      [input.purchaseId, input.agentId],
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_NOT_FOUND", "طلب الشراء غير موجود");
    }

    if (purchase.status === "approved" && purchase.settlement_operation_id) {
      const replayResult = await client.query<{
        agent_balance_after: string;
        member_balance_after: string;
      }>(
        `SELECT "metadata"->>'agentBalanceAfter' AS "agent_balance_after",
                "metadata"->>'memberBalanceAfter' AS "member_balance_after"
         FROM "wallet_operations"
         WHERE "id" = $1 AND "operation_type" = $2
           AND "reference_type" = $3 AND "reference_id" = $4
         LIMIT 1`,
        [purchase.settlement_operation_id, OPERATION_TYPE, REFERENCE_TYPE, purchase.id],
      );
      const replay = replayResult.rows[0];
      if (!replay?.agent_balance_after || !/^\d+$/.test(replay.agent_balance_after) ||
          !replay.member_balance_after || !/^\d+$/.test(replay.member_balance_after)) {
        throw new MemberCoinPurchaseError("LEDGER_INCONSISTENT", "تعذر التحقق من اعتماد طلب الشراء");
      }
      await client.query("COMMIT");
      transactionStarted = false;
      return {
        id: purchase.id,
        memberUserId: purchase.member_user_id,
        agentId: purchase.agent_id,
        amountCoins: purchase.coin_amount,
        status: "approved",
        agentBalance: replay.agent_balance_after,
        memberBalance: replay.member_balance_after,
        replayed: true,
      };
    }

    if (purchase.status !== "submitted" ||
        !purchase.payment_reference ||
        !purchase.proof_object_key ||
        !purchase.proof_uploaded_at) {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_NOT_PAYABLE", "الطلب لا يحتوي إثبات دفع قابلًا للمراجعة");
    }
    const receiptUploadedAt = new Date(purchase.proof_uploaded_at).getTime();
    if (!Number.isFinite(receiptUploadedAt) || Date.now() >= receiptUploadedAt + RECEIPT_RETENTION_MS) {
      throw new MemberCoinPurchaseError("RECEIPT_EXPIRED", "انتهت مدة الاحتفاظ بإيصال الدفع");
    }

    const amount = BigInt(purchase.coin_amount);
    if (amount <= 0n || amount > MAX_POSTGRES_BIGINT) {
      throw new MemberCoinPurchaseError("LEDGER_INCONSISTENT", "كمية العملات غير صالحة");
    }

    await client.query(
      `INSERT INTO "wallet_balances" ("account_type", "user_id", "agent_id", "bucket")
       VALUES
         ('agent', NULL, $1, 'agent_inventory'),
         ('member', $2, NULL, 'legacy_spendable'),
         ('member', $2, NULL, 'cashable_spendable')
       ON CONFLICT ("user_id", "bucket")
         WHERE "account_type" = 'member' AND "user_id" IS NOT NULL
       DO NOTHING`,
      [input.agentId, purchase.member_user_id],
    );

    const accountResult = await client.query<PurchaseBalanceRow>(
      `SELECT "id", "account_type", "user_id", "agent_id", "bucket",
              "balance_coins"::text AS "balance_coins"
       FROM "wallet_balances"
       WHERE (
         "account_type" = 'agent' AND "agent_id" = $1 AND "bucket" = 'agent_inventory'
           AND "user_id" IS NULL
       ) OR (
         "account_type" = 'member' AND "user_id" = $2
           AND "bucket" IN ('legacy_spendable', 'cashable_spendable')
       )
       ORDER BY "account_type", "user_id" NULLS FIRST, "bucket", "id"
       FOR UPDATE`,
      [input.agentId, purchase.member_user_id],
    );
    const agentInventory = accountResult.rows.find((row) =>
      row.account_type === "agent" && row.agent_id === input.agentId && row.bucket === "agent_inventory",
    );
    const memberCashable = accountResult.rows.find((row) =>
      row.account_type === "member" &&
      row.user_id === purchase.member_user_id &&
      row.bucket === "cashable_spendable",
    );
    if (!agentInventory || !memberCashable) {
      throw new MemberCoinPurchaseError("LEDGER_ACCOUNT_NOT_INITIALIZED", "حسابات المحفظة غير مهيأة");
    }
    const agentBefore = parseLedgerBalance(agentInventory.balance_coins);
    const memberBefore = parseLedgerBalance(memberCashable.balance_coins);
    if (agentBefore < amount) {
      throw new MemberCoinPurchaseError("INSUFFICIENT_AGENT_INVENTORY", "رصيد الوكيل غير كافٍ");
    }
    const agentAfter = agentBefore - amount;
    const memberAfter = memberBefore + amount;
    if (memberAfter > MAX_POSTGRES_BIGINT) {
      throw new MemberCoinPurchaseError("LEDGER_INCONSISTENT", "أرصدة المحفظة غير صالحة");
    }

    const idempotencyKey = `member-coin-purchase:${purchase.id}`;
    const fingerprint = hashRequest({
      operationType: OPERATION_TYPE,
      purchaseId: purchase.id,
      agentId: purchase.agent_id,
      memberUserId: purchase.member_user_id,
      amountCoins: amount.toString(),
      paymentReference: purchase.payment_reference.trim().toLowerCase(),
    });
    const metadata = {
      purchaseId: purchase.id,
      agentId: purchase.agent_id,
      memberUserId: purchase.member_user_id,
      amountCoins: amount.toString(),
      paymentVerified: true,
      priceMinorUnits: purchase.price_minor_units,
      currencyCode: purchase.currency_code,
      paymentReference: purchase.payment_reference,
      agentBalanceAfter: agentAfter.toString(),
      memberBalanceAfter: memberAfter.toString(),
    };
    const operationResult = await client.query<{ id: string }>(
      `INSERT INTO "wallet_operations"
        ("actor_scope", "actor_agent_id", "operation_type", "idempotency_key",
         "request_fingerprint", "reference_type", "reference_id", "metadata")
       VALUES ('agent', $1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        input.agentId,
        OPERATION_TYPE,
        idempotencyKey,
        fingerprint,
        REFERENCE_TYPE,
        purchase.id,
        JSON.stringify(metadata),
      ],
    );
    const operationId = operationResult.rows[0]?.id;
    if (!operationId) {
      throw new MemberCoinPurchaseError("IDEMPOTENCY_CONFLICT", "سبق تسجيل تسوية مختلفة لهذا الطلب");
    }

    for (const [account, delta, expectedBalance] of [
      [agentInventory, -amount, agentAfter],
      [memberCashable, amount, memberAfter],
    ] as const) {
      const updated = await client.query<{ id: string; balance_coins: string }>(
        `UPDATE "wallet_balances"
         SET "balance_coins" = "balance_coins" + $1::bigint, "updated_at" = now()
         WHERE "id" = $2 AND "balance_coins" + $1::bigint >= 0
         RETURNING "id", "balance_coins"::text AS "balance_coins"`,
        [delta.toString(), account.id],
      );
      if (updated.rows.length !== 1 || updated.rows[0].balance_coins !== expectedBalance.toString()) {
        throw new MemberCoinPurchaseError("LEDGER_INCONSISTENT", "تعذر تحديث أرصدة الشراء بشكل متوازن");
      }
      await client.query(
        `INSERT INTO "wallet_entries" ("operation_id", "wallet_balance_id", "amount")
         VALUES ($1, $2, $3::bigint)`,
        [operationId, account.id, delta.toString()],
      );
    }

    const updatedPurchase = await client.query(
      `UPDATE "member_coin_purchases"
       SET "status" = 'approved', "reviewed_by_agent_id" = $1,
           "reviewed_at" = now(), "settlement_operation_id" = $2,
           "receipt_expires_at" = "proof_uploaded_at" + interval '30 days',
           "updated_at" = now()
       WHERE "id" = $3 AND "agent_id" = $1 AND "status" = 'submitted'`,
      [input.agentId, operationId, purchase.id],
    );
    if (updatedPurchase.rowCount !== 1) {
      throw new MemberCoinPurchaseError("MEMBER_PURCHASE_ALREADY_REVIEWED", "سبق التعامل مع طلب الشراء");
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return {
      id: purchase.id,
      memberUserId: purchase.member_user_id,
      agentId: purchase.agent_id,
      amountCoins: amount.toString(),
      status: "approved",
      agentBalance: agentAfter.toString(),
      memberBalance: memberAfter.toString(),
      replayed: false,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "member coin purchase settlement rollback failed");
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
