import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";

const OPERATION_TYPE = "agent_inventory_settlement";
const REFERENCE_TYPE = "agent_inventory_order";
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const hasDisallowedControl = (value: string, allowLineBreaks = false) => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127 || (code < 32 && !(allowLineBreaks && [9, 10, 13].includes(code)))) {
      return true;
    }
  }
  return false;
};

const isConstraintViolation = (error: unknown, constraint: string) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint,
  );

export class AgentInventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentInventoryError";
  }
}

export type AgentInventoryPersistence = {
  connect: () => Promise<PoolClient>;
};

type InventoryOrderRow = {
  id: string;
  agent_id: string;
  requested_coins: string;
  quoted_price_minor_units: string | null;
  currency_code: string | null;
  payment_instructions_snapshot: string | null;
  payment_reference: string | null;
  proof_object_key: string | null;
  proof_uploaded_at: Date | string | null;
  status: string;
  settlement_operation_id: string | null;
  reviewed_by_user_id: string | null;
  rejection_reason: string | null;
  created_at: Date | string;
};

type InventoryBalanceRow = {
  id: string;
  account_type: "agent" | "system";
  agent_id: string | null;
  bucket: string;
  balance_coins: string;
};

const defaultPersistence: AgentInventoryPersistence = {
  connect: () => dbPool.connect(),
};

const validateAgentId = (agentId: string) => {
  if (!UUID_PATTERN.test(agentId)) {
    throw new AgentInventoryError("INVALID_INVENTORY_ORDER", "معرّف الوكيل غير صالح");
  }
};

const normalizeInventoryRequest = (input: {
  agentId: string;
  requestedCoins: number;
  idempotencyKey: string;
}) => {
  validateAgentId(input.agentId);
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (
    !Number.isSafeInteger(input.requestedCoins) ||
    input.requestedCoins <= 0 ||
    BigInt(input.requestedCoins) > MAX_POSTGRES_BIGINT ||
    !idempotencyKey ||
    idempotencyKey.length > 128 ||
    hasDisallowedControl(idempotencyKey)
  ) {
    throw new AgentInventoryError("INVALID_INVENTORY_ORDER", "بيانات طلب المخزون غير صالحة");
  }
  return { ...input, requestedCoins: BigInt(input.requestedCoins), idempotencyKey };
};

const inventoryRequestFingerprint = (input: ReturnType<typeof normalizeInventoryRequest>) =>
  createHash("sha256")
    .update(JSON.stringify({
      operationType: "agent_inventory_order",
      agentId: input.agentId,
      requestedCoins: input.requestedCoins.toString(),
    }))
    .digest("hex");

export const createAgentInventoryOrder = async (
  rawInput: { agentId: string; requestedCoins: number; idempotencyKey: string },
  persistence: AgentInventoryPersistence = defaultPersistence,
) => {
  const input = normalizeInventoryRequest(rawInput);
  const fingerprint = inventoryRequestFingerprint(input);
  const client = await persistence.connect();
  try {
    const inserted = await client.query<{
      id: string;
      requested_coins: string;
      status: string;
      created_at: Date | string;
    }>(
      `INSERT INTO "wallet_agent_inventory_orders"
        ("agent_id", "requested_coins", "idempotency_key", "request_fingerprint")
       VALUES ($1, $2::bigint, $3, $4)
       ON CONFLICT ("agent_id", "idempotency_key") DO NOTHING
       RETURNING "id", "requested_coins"::text AS "requested_coins", "status", "created_at"`,
      [input.agentId, input.requestedCoins.toString(), input.idempotencyKey, fingerprint],
    );
    if (inserted.rows[0]) {
      return { ...inserted.rows[0], replayed: false };
    }

    const existing = await client.query<{
      id: string;
      requested_coins: string;
      request_fingerprint: string;
      status: string;
      created_at: Date | string;
    }>(
      `SELECT "id", "requested_coins"::text AS "requested_coins",
              "request_fingerprint", "status", "created_at"
       FROM "wallet_agent_inventory_orders"
       WHERE "agent_id" = $1 AND "idempotency_key" = $2
       LIMIT 1`,
      [input.agentId, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_fingerprint !== fingerprint) {
      throw new AgentInventoryError("IDEMPOTENCY_CONFLICT", "مفتاح الطلب مستخدم ببيانات مختلفة");
    }
    return { ...row, replayed: true };
  } finally {
    client.release();
  }
};

export const quoteAgentInventoryOrder = async (
  input: {
    orderId: string;
    siteOwnerUserId: string;
    priceMinorUnits: number;
    currencyCode: string;
    paymentInstructions: string;
  },
  persistence: AgentInventoryPersistence = defaultPersistence,
) => {
  const paymentInstructions = typeof input.paymentInstructions === "string"
    ? input.paymentInstructions.trim()
    : "";
  if (
    !UUID_PATTERN.test(input.orderId) ||
    typeof input.siteOwnerUserId !== "string" ||
    !input.siteOwnerUserId.trim() ||
    input.siteOwnerUserId.length > 255 ||
    !Number.isSafeInteger(input.priceMinorUnits) ||
    input.priceMinorUnits <= 0 ||
    typeof input.currencyCode !== "string" ||
    !/^[A-Z]{3}$/.test(input.currencyCode) ||
    paymentInstructions.length < 1 ||
    paymentInstructions.length > 4000 ||
    hasDisallowedControl(paymentInstructions, true)
  ) {
    throw new AgentInventoryError("INVALID_INVENTORY_QUOTE", "بيانات عرض سعر المخزون غير صالحة");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query<InventoryOrderRow>(
      `SELECT "id", "agent_id", "requested_coins"::text AS "requested_coins",
              "quoted_price_minor_units"::text AS "quoted_price_minor_units",
              "currency_code", "payment_instructions_snapshot", "payment_reference",
              "proof_object_key", "proof_uploaded_at", "status", "settlement_operation_id",
              "reviewed_by_user_id", "rejection_reason", "created_at"
       FROM "wallet_agent_inventory_orders"
       WHERE "id" = $1
       FOR UPDATE`,
      [input.orderId],
    );
    const order = result.rows[0];
    if (!order) throw new AgentInventoryError("INVENTORY_ORDER_NOT_FOUND", "طلب المخزون غير موجود");

    if (
      order.status === "quoted" &&
      order.quoted_price_minor_units === String(input.priceMinorUnits) &&
      order.currency_code === input.currencyCode &&
      order.payment_instructions_snapshot === paymentInstructions
    ) {
      await client.query("COMMIT");
      transactionStarted = false;
      return { id: order.id, status: order.status, replayed: true };
    }
    if (order.status !== "requested") {
      throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "لا يمكن تغيير عرض سعر هذا الطلب");
    }

    const updated = await client.query(
      `UPDATE "wallet_agent_inventory_orders"
       SET "quoted_price_minor_units" = $1::bigint, "currency_code" = $2,
           "payment_instructions_snapshot" = $3, "quoted_by_user_id" = $4,
           "quoted_at" = now(), "status" = 'quoted', "updated_at" = now()
       WHERE "id" = $5 AND "status" = 'requested'`,
      [
        String(input.priceMinorUnits),
        input.currencyCode,
        paymentInstructions,
        input.siteOwnerUserId,
        order.id,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "سبق التعامل مع طلب المخزون");
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { id: order.id, status: "quoted", replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "agent inventory quote rollback failed");
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

const isPrivateProofObjectKey = (value: string) =>
  /^wallet-proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.(?:jpg|jpeg|png|webp))?$/i.test(value);

export const submitAgentInventoryOrderPayment = async (
  input: {
    orderId: string;
    agentId: string;
    paymentReference: string;
    proofObjectKey: string;
  },
  persistence: AgentInventoryPersistence = defaultPersistence,
) => {
  validateAgentId(input.agentId);
  const paymentReference = typeof input.paymentReference === "string"
    ? input.paymentReference.trim()
    : "";
  if (
    !UUID_PATTERN.test(input.orderId) ||
    paymentReference.length < 1 ||
    paymentReference.length > 255 ||
    hasDisallowedControl(paymentReference) ||
    typeof input.proofObjectKey !== "string" ||
    !isPrivateProofObjectKey(input.proofObjectKey)
  ) {
    throw new AgentInventoryError("INVALID_INVENTORY_PAYMENT", "بيانات إثبات الدفع غير صالحة");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query<InventoryOrderRow>(
      `SELECT "id", "agent_id", "requested_coins"::text AS "requested_coins",
              "quoted_price_minor_units"::text AS "quoted_price_minor_units",
              "currency_code", "payment_instructions_snapshot", "payment_reference",
              "proof_object_key", "proof_uploaded_at", "status", "settlement_operation_id",
              "reviewed_by_user_id", "rejection_reason", "created_at"
       FROM "wallet_agent_inventory_orders"
       WHERE "id" = $1
       FOR UPDATE`,
      [input.orderId],
    );
    const order = result.rows[0];
    if (!order) throw new AgentInventoryError("INVENTORY_ORDER_NOT_FOUND", "طلب المخزون غير موجود");
    if (order.agent_id !== input.agentId) {
      throw new AgentInventoryError("INVENTORY_ORDER_NOT_FOUND", "طلب المخزون غير موجود");
    }
    if (
      order.status === "submitted" &&
      order.payment_reference?.trim().toLowerCase() === paymentReference.toLowerCase()
    ) {
      await client.query("COMMIT");
      transactionStarted = false;
      return { id: order.id, status: order.status, replayed: true };
    }
    if (order.status !== "quoted") {
      throw new AgentInventoryError("INVENTORY_ORDER_NOT_PAYABLE", "لا يمكن إرسال إثبات لهذا الطلب");
    }

    const updated = await client.query(
      `UPDATE "wallet_agent_inventory_orders"
       SET "payment_reference" = $1, "proof_object_key" = $2,
          "proof_uploaded_at" = now(), "receipt_expires_at" = now() + interval '30 days',
          "status" = 'submitted', "updated_at" = now()
       WHERE "id" = $3 AND "agent_id" = $4 AND "status" = 'quoted'`,
      [paymentReference, input.proofObjectKey, order.id, input.agentId],
    );
    if (updated.rowCount !== 1) {
      throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "سبق التعامل مع طلب المخزون");
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { id: order.id, status: "submitted", replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "agent inventory payment submission rollback failed");
      }
    }
    if (isConstraintViolation(error, "wallet_agent_inventory_orders_payment_reference_idx")) {
      throw new AgentInventoryError("DUPLICATE_PAYMENT_REFERENCE", "سبق استخدام مرجع التحويل");
    }
    throw error;
  } finally {
    client.release();
  }
};

export const rejectAgentInventoryOrder = async (
  input: { orderId: string; siteOwnerUserId: string; reason: string },
  persistence: AgentInventoryPersistence = defaultPersistence,
) => {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (
    !UUID_PATTERN.test(input.orderId) ||
    typeof input.siteOwnerUserId !== "string" ||
    !input.siteOwnerUserId.trim() ||
    input.siteOwnerUserId.length > 255 ||
    reason.length < 2 ||
    reason.length > 500 ||
    hasDisallowedControl(reason, true)
  ) {
    throw new AgentInventoryError("INVALID_INVENTORY_ORDER", "بيانات رفض طلب المخزون غير صالحة");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query<InventoryOrderRow>(
      `SELECT "id", "agent_id", "requested_coins"::text AS "requested_coins",
              "quoted_price_minor_units"::text AS "quoted_price_minor_units",
              "currency_code", "payment_instructions_snapshot", "payment_reference",
              "proof_object_key", "proof_uploaded_at", "status", "settlement_operation_id",
              "reviewed_by_user_id", "rejection_reason", "created_at"
       FROM "wallet_agent_inventory_orders"
       WHERE "id" = $1
       FOR UPDATE`,
      [input.orderId],
    );
    const order = result.rows[0];
    if (!order) throw new AgentInventoryError("INVENTORY_ORDER_NOT_FOUND", "طلب المخزون غير موجود");
    if (
      order.status === "rejected" &&
      order.reviewed_by_user_id === input.siteOwnerUserId &&
      order.rejection_reason === reason
    ) {
      await client.query("COMMIT");
      transactionStarted = false;
      return { id: order.id, status: order.status, replayed: true };
    }
    if (order.status === "approved" || order.status === "rejected") {
      throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "سبق التعامل مع طلب المخزون");
    }

    const updated = await client.query(
      `UPDATE "wallet_agent_inventory_orders"
       SET "status" = 'rejected', "reviewed_by_user_id" = $1,
           "reviewed_at" = now(), "rejection_reason" = $2,
           "receipt_expires_at" = CASE WHEN "proof_uploaded_at" IS NULL
             THEN NULL ELSE "proof_uploaded_at" + interval '30 days' END,
           "updated_at" = now()
       WHERE "id" = $3 AND "status" IN ('requested', 'quoted', 'submitted')`,
      [input.siteOwnerUserId, reason, order.id],
    );
    if (updated.rowCount !== 1) {
      throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "سبق التعامل مع طلب المخزون");
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { id: order.id, status: "rejected", replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "agent inventory rejection rollback failed");
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

const normalizeBalance = (value: string): bigint => {
  if (!/^\d+$/.test(value)) {
    throw new AgentInventoryError("LEDGER_INCONSISTENT", "رصيد المحفظة غير صالح");
  }
  const balance = BigInt(value);
  if (balance > MAX_POSTGRES_BIGINT) {
    throw new AgentInventoryError("LEDGER_INCONSISTENT", "رصيد المحفظة يتجاوز الحد المسموح");
  }
  return balance;
};

const readAgentInventoryBalance = async (agentId: string): Promise<string | null> => {
  const result = await dbPool.query<{ balance_coins: string }>(
    `SELECT "balance_coins"::text AS "balance_coins"
     FROM "wallet_balances"
     WHERE "account_type" = 'agent'
       AND "agent_id" = $1
       AND "user_id" IS NULL
       AND "bucket" = 'agent_inventory'
     LIMIT 1`,
    [agentId],
  );
  return result.rows[0]?.balance_coins ?? null;
};

export const getAgentInventoryBalance = async (
  agentId: string,
  readBalance: (agentId: string) => Promise<string | null> = readAgentInventoryBalance,
): Promise<string> => {
  validateAgentId(agentId);
  return normalizeBalance(await readBalance(agentId) ?? "0").toString();
};

export type ApproveAgentInventoryOrderResult = {
  id: string;
  agentId: string;
  amountCoins: string;
  siteWalletBalance: string;
  agentBalance: string;
  replayed: boolean;
};

export const approveAgentInventoryOrder = async (
  input: { orderId: string; siteOwnerUserId: string; paymentVerified: boolean },
  persistence: AgentInventoryPersistence = defaultPersistence,
): Promise<ApproveAgentInventoryOrderResult> => {
  if (
    !UUID_PATTERN.test(input.orderId) ||
    typeof input.siteOwnerUserId !== "string" ||
    !input.siteOwnerUserId.trim() ||
    input.siteOwnerUserId.length > 255 ||
    input.paymentVerified !== true
  ) {
    throw new AgentInventoryError("PAYMENT_NOT_VERIFIED", "يلزم تأكيد التحقق من التحويل قبل اعتماد المخزون");
  }

  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      REFERENCE_TYPE,
      input.orderId,
    ]);

    const orderResult = await client.query<InventoryOrderRow>(
      `SELECT "id", "agent_id", "requested_coins"::text AS "requested_coins",
              "quoted_price_minor_units"::text AS "quoted_price_minor_units",
              "currency_code", "payment_instructions_snapshot", "payment_reference",
              "proof_object_key", "proof_uploaded_at", "status", "settlement_operation_id",
              "reviewed_by_user_id", "rejection_reason", "created_at"
       FROM "wallet_agent_inventory_orders"
       WHERE "id" = $1
       FOR UPDATE`,
      [input.orderId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new AgentInventoryError("INVENTORY_ORDER_NOT_FOUND", "طلب المخزون غير موجود");

    if (order.status === "approved" && order.settlement_operation_id) {
      if (order.reviewed_by_user_id !== input.siteOwnerUserId) {
        throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "سبق اعتماد طلب المخزون");
      }
      const replay = await client.query<{
        site_balance_after: string;
        agent_balance_after: string;
      }>(
        `SELECT "metadata"->>'siteBalanceAfter' AS "site_balance_after",
                "metadata"->>'agentBalanceAfter' AS "agent_balance_after"
         FROM "wallet_operations"
         WHERE "id" = $1 AND "operation_type" = $2
           AND "reference_type" = $3 AND "reference_id" = $4
         LIMIT 1`,
        [order.settlement_operation_id, OPERATION_TYPE, REFERENCE_TYPE, order.id],
      );
      const prior = replay.rows[0];
      if (
        !prior ||
        !prior.site_balance_after ||
        !/^\d+$/.test(prior.site_balance_after) ||
        !prior.agent_balance_after ||
        !/^\d+$/.test(prior.agent_balance_after)
      ) {
        throw new AgentInventoryError("LEDGER_INCONSISTENT", "تعذر التحقق من اعتماد طلب المخزون");
      }
      await client.query("COMMIT");
      transactionStarted = false;
      return {
        id: order.id,
        agentId: order.agent_id,
        amountCoins: order.requested_coins,
        siteWalletBalance: prior.site_balance_after,
        agentBalance: prior.agent_balance_after,
        replayed: true,
      };
    }

    if (order.status !== "submitted" || !order.payment_reference || !order.proof_object_key) {
      throw new AgentInventoryError("INVENTORY_ORDER_NOT_PAYABLE", "الطلب لا يحتوي إثبات دفع قابلًا للمراجعة");
    }
    const proofUploadedAt = order.proof_uploaded_at
      ? new Date(order.proof_uploaded_at).getTime()
      : Number.NaN;
    if (!Number.isFinite(proofUploadedAt) || Date.now() >= proofUploadedAt + RECEIPT_RETENTION_MS) {
      throw new AgentInventoryError("RECEIPT_EXPIRED", "انتهت مدة الاحتفاظ بإيصال الدفع");
    }
    if (
      !order.quoted_price_minor_units ||
      !/^\d+$/.test(order.quoted_price_minor_units) ||
      BigInt(order.quoted_price_minor_units) <= 0n ||
      !order.currency_code ||
      !/^[A-Z]{3}$/.test(order.currency_code)
    ) {
      throw new AgentInventoryError("LEDGER_INCONSISTENT", "عرض سعر طلب المخزون غير صالح");
    }

    const amount = BigInt(order.requested_coins);
    if (amount <= 0n || amount > MAX_POSTGRES_BIGINT) {
      throw new AgentInventoryError("LEDGER_INCONSISTENT", "كمية المخزون غير صالحة");
    }

    await client.query(
      `INSERT INTO "wallet_balances" ("account_type", "user_id", "agent_id", "bucket")
       VALUES ('agent', NULL, $1, 'agent_inventory')
       ON CONFLICT ("agent_id", "bucket")
         WHERE "account_type" = 'agent' AND "agent_id" IS NOT NULL
       DO NOTHING`,
      [order.agent_id],
    );

    const accountsResult = await client.query<InventoryBalanceRow>(
      `SELECT "id", "account_type", "agent_id", "bucket",
              "balance_coins"::text AS "balance_coins"
       FROM "wallet_balances"
       WHERE (
         "account_type" = 'system' AND "bucket" = 'site_inventory' AND "user_id" IS NULL
       ) OR (
         "account_type" = 'agent' AND "agent_id" = $1 AND "bucket" = 'agent_inventory'
           AND "user_id" IS NULL
       )
       ORDER BY "account_type", "agent_id", "bucket", "id"
       FOR UPDATE`,
      [order.agent_id],
    );
    const siteInventory = accountsResult.rows.find((row) =>
      row.account_type === "system" && row.bucket === "site_inventory",
    );
    const agentInventory = accountsResult.rows.find((row) =>
      row.account_type === "agent" && row.agent_id === order.agent_id && row.bucket === "agent_inventory",
    );
    if (!siteInventory || !agentInventory || accountsResult.rows.length !== 2) {
      throw new AgentInventoryError("LEDGER_ACCOUNT_NOT_INITIALIZED", "حسابات مخزون الموقع أو الوكيل غير مهيأة");
    }

    const siteBefore = normalizeBalance(siteInventory.balance_coins);
    const agentBefore = normalizeBalance(agentInventory.balance_coins);
    if (siteBefore < amount) {
      throw new AgentInventoryError("INSUFFICIENT_SITE_INVENTORY", "رصيد مخزون الموقع غير كافٍ");
    }
    const siteAfter = siteBefore - amount;
    const agentAfter = agentBefore + amount;
    if (agentAfter > MAX_POSTGRES_BIGINT) {
      throw new AgentInventoryError("BALANCE_OVERFLOW", "قيمة مخزون الوكيل تتجاوز الحد المسموح");
    }

    const idempotencyKey = `agent-inventory-order:${order.id}`;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        operationType: OPERATION_TYPE,
        orderId: order.id,
        agentId: order.agent_id,
        amountCoins: amount.toString(),
        paymentReference: order.payment_reference.trim().toLowerCase(),
        priceMinorUnits: order.quoted_price_minor_units,
        currencyCode: order.currency_code,
      }))
      .digest("hex");
    const metadata = {
      siteOwnerUserId: input.siteOwnerUserId,
      agentId: order.agent_id,
      amountCoins: amount.toString(),
      paymentVerified: true,
      paymentReference: order.payment_reference,
      priceMinorUnits: order.quoted_price_minor_units,
      currencyCode: order.currency_code,
      siteBalanceAfter: siteAfter.toString(),
      agentBalanceAfter: agentAfter.toString(),
    };
    const operationResult = await client.query<{ id: string }>(
      `INSERT INTO "wallet_operations"
        ("actor_scope", "operation_type", "idempotency_key", "request_fingerprint",
         "reference_type", "reference_id", "metadata")
       VALUES ('system', $1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        OPERATION_TYPE,
        idempotencyKey,
        fingerprint,
        REFERENCE_TYPE,
        order.id,
        JSON.stringify(metadata),
      ],
    );
    const operationId = operationResult.rows[0]?.id;
    if (!operationId) {
      throw new AgentInventoryError("IDEMPOTENCY_CONFLICT", "سبق تسجيل تسوية مختلفة لهذا الطلب");
    }

    for (const [account, delta, expectedBalance] of [
      [siteInventory, -amount, siteAfter],
      [agentInventory, amount, agentAfter],
    ] as const) {
      const updated = await client.query<{ id: string; balance_coins: string }>(
        `UPDATE "wallet_balances"
         SET "balance_coins" = "balance_coins" + $1::bigint, "updated_at" = now()
         WHERE "id" = $2 AND "balance_coins" + $1::bigint >= 0
         RETURNING "id", "balance_coins"::text AS "balance_coins"`,
        [delta.toString(), account.id],
      );
      if (updated.rows.length !== 1 || updated.rows[0].balance_coins !== expectedBalance.toString()) {
        throw new AgentInventoryError("LEDGER_INCONSISTENT", "تعذر تحديث أرصدة المخزون بشكل متوازن");
      }
      await client.query(
        `INSERT INTO "wallet_entries" ("operation_id", "wallet_balance_id", "amount")
         VALUES ($1, $2, $3::bigint)`,
        [operationId, account.id, delta.toString()],
      );
    }

    const updatedOrder = await client.query(
      `UPDATE "wallet_agent_inventory_orders"
       SET "status" = 'approved', "reviewed_by_user_id" = $1, "reviewed_at" = now(),
           "settlement_operation_id" = $2,
           "receipt_expires_at" = "proof_uploaded_at" + interval '30 days', "updated_at" = now()
       WHERE "id" = $3 AND "status" = 'submitted'`,
      [input.siteOwnerUserId, operationId, order.id],
    );
    if (updatedOrder.rowCount !== 1) {
      throw new AgentInventoryError("INVENTORY_ORDER_ALREADY_REVIEWED", "سبق التعامل مع طلب المخزون");
    }

    await client.query("COMMIT");
    transactionStarted = false;
    return {
      id: order.id,
      agentId: order.agent_id,
      amountCoins: amount.toString(),
      siteWalletBalance: siteAfter.toString(),
      agentBalance: agentAfter.toString(),
      replayed: false,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "agent inventory settlement failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
