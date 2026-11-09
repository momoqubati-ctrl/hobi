import { dbPool } from "../db";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const hasInvalidControl = (value: string) => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127 || (code < 32 && ![9, 10, 13].includes(code))) return true;
  }
  return false;
};

export class AgentPackageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentPackageError";
  }
}

export type AgentPackagePersistence = Pick<typeof dbPool, "query">;

const normalizePackageInput = (input: {
  agentId: string;
  coinAmount: number;
  priceMinorUnits: number;
  currencyCode: string;
  paymentInstructions: string;
}) => {
  const paymentInstructions = typeof input.paymentInstructions === "string"
    ? input.paymentInstructions.trim()
    : "";
  if (
    !UUID_PATTERN.test(input.agentId) ||
    !Number.isSafeInteger(input.coinAmount) ||
    input.coinAmount <= 0 ||
    !Number.isSafeInteger(input.priceMinorUnits) ||
    input.priceMinorUnits <= 0 ||
    typeof input.currencyCode !== "string" ||
    !/^[A-Z]{3}$/.test(input.currencyCode) ||
    paymentInstructions.length < 1 ||
    paymentInstructions.length > 4000 ||
    hasInvalidControl(paymentInstructions)
  ) {
    throw new AgentPackageError("INVALID_AGENT_PACKAGE", "بيانات باقة العملات غير صالحة");
  }
  return {
    ...input,
    coinAmount: String(input.coinAmount),
    priceMinorUnits: String(input.priceMinorUnits),
    paymentInstructions,
  };
};

export const listAgentPackages = async (
  agentId: string,
  persistence: AgentPackagePersistence = dbPool,
) => {
  if (!UUID_PATTERN.test(agentId)) {
    throw new AgentPackageError("INVALID_AGENT_PACKAGE", "معرّف الوكيل غير صالح");
  }
  const result = await persistence.query(
    `SELECT "id", "coin_amount"::text AS "coinAmount",
            "price_minor_units"::text AS "priceMinorUnits",
            "currency_code" AS "currencyCode",
            "payment_instructions" AS "paymentInstructions",
            "is_active" AS "isActive", "created_at" AS "createdAt",
            "updated_at" AS "updatedAt"
     FROM "wallet_agent_packages"
     WHERE "agent_id" = $1
     ORDER BY "coin_amount" ASC`,
    [agentId],
  );
  return result.rows;
};

export const saveAgentPackage = async (
  rawInput: {
    agentId: string;
    coinAmount: number;
    priceMinorUnits: number;
    currencyCode: string;
    paymentInstructions: string;
  },
  persistence: AgentPackagePersistence = dbPool,
) => {
  const input = normalizePackageInput(rawInput);
  const result = await persistence.query<{
    id: string;
    agent_id: string;
    coin_amount: string;
    price_minor_units: string;
    currency_code: string;
    payment_instructions: string;
    is_active: boolean;
  }>(
    `INSERT INTO "wallet_agent_packages"
      ("agent_id", "coin_amount", "price_minor_units", "currency_code", "payment_instructions")
     VALUES ($1, $2::bigint, $3::bigint, $4, $5)
     ON CONFLICT ("agent_id", "coin_amount")
     DO UPDATE SET "price_minor_units" = EXCLUDED."price_minor_units",
                   "currency_code" = EXCLUDED."currency_code",
                   "payment_instructions" = EXCLUDED."payment_instructions",
                   "is_active" = true, "updated_at" = now()
     RETURNING "id", "agent_id", "coin_amount"::text AS "coin_amount",
               "price_minor_units"::text AS "price_minor_units",
               "currency_code", "payment_instructions", "is_active"`,
    [
      input.agentId,
      input.coinAmount,
      input.priceMinorUnits,
      input.currencyCode,
      input.paymentInstructions,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AgentPackageError("AGENT_PACKAGE_SAVE_FAILED", "تعذر حفظ باقة العملات");
  }
  return row;
};

export const setAgentPackageActive = async (
  agentId: string,
  packageId: string,
  isActive: boolean,
  persistence: AgentPackagePersistence = dbPool,
) => {
  if (!UUID_PATTERN.test(agentId) || !UUID_PATTERN.test(packageId) || typeof isActive !== "boolean") {
    throw new AgentPackageError("INVALID_AGENT_PACKAGE", "بيانات باقة العملات غير صالحة");
  }
  const result = await persistence.query(
    `UPDATE "wallet_agent_packages"
     SET "is_active" = $3, "updated_at" = now()
     WHERE "id" = $1 AND "agent_id" = $2
     RETURNING "id", "is_active" AS "isActive"`,
    [packageId, agentId, isActive],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AgentPackageError("AGENT_PACKAGE_NOT_FOUND", "باقة العملات غير موجودة");
  }
  return row;
};
