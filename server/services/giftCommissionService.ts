import type { PoolClient } from "pg";
import { dbPool } from "../db";
import { logAdminAudit } from "./adminPermissions";

const GIFT_COMMISSION_SETTING_KEY = "gift_commission";
const GIFT_COMMISSION_LOCK_NAMESPACE = 1_465_000_013;

export class GiftCommissionInputError extends Error {
  constructor() {
    super("نسبة العمولة غير صالحة");
    this.name = "GiftCommissionInputError";
  }
}

export type GiftCommissionSettings = {
  configured: boolean;
  commissionRatePercent: number | null;
  roundingMode: "floor";
  updatedAt: string | null;
};

export type GiftCommissionPersistence = {
  connect: () => Promise<PoolClient>;
  logAudit: typeof logAdminAudit;
};

const defaultPersistence: GiftCommissionPersistence = {
  connect: () => dbPool.connect(),
  logAudit: logAdminAudit,
};

const isValidRateBasisPoints = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000;

export const getGiftCommissionRateBasisPoints = (value: unknown): number | null => {
  if (typeof value !== "object" || value === null || !("commissionRateBasisPoints" in value)) {
    return null;
  }
  return isValidRateBasisPoints(value.commissionRateBasisPoints)
    ? value.commissionRateBasisPoints
    : null;
};

export const parseGiftCommissionPercent = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new GiftCommissionInputError();

  const match = /^(0|[1-9]\d{0,2})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new GiftCommissionInputError();

  const wholePercent = Number(match[1]);
  const fractionalPercent = Number((match[2] ?? "").padEnd(2, "0"));
  const rateBasisPoints = wholePercent * 100 + fractionalPercent;
  if (!isValidRateBasisPoints(rateBasisPoints)) throw new GiftCommissionInputError();
  return rateBasisPoints;
};

export const calculateGiftCommissionCoins = (giftCoins: bigint, rateBasisPoints: number): bigint => {
  if (giftCoins < 0n || !isValidRateBasisPoints(rateBasisPoints)) {
    throw new GiftCommissionInputError();
  }
  return (giftCoins * BigInt(rateBasisPoints)) / 10_000n;
};

export const getGiftCommissionSettings = async (): Promise<GiftCommissionSettings> => {
  const result = await dbPool.query<{ value: unknown; updated_at: Date | string }>(
    `SELECT "value", "updated_at"
     FROM "wallet_settings"
     WHERE "key" = $1
     LIMIT 1`,
    [GIFT_COMMISSION_SETTING_KEY],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      configured: false,
      commissionRatePercent: null,
      roundingMode: "floor",
      updatedAt: null,
    };
  }

  const rateBasisPoints = getGiftCommissionRateBasisPoints(row.value);
  if (rateBasisPoints === null) {
    throw new Error("stored gift commission setting is invalid");
  }

  return {
    configured: true,
    commissionRatePercent: rateBasisPoints / 100,
    roundingMode: "floor",
    updatedAt: new Date(row.updated_at).toISOString(),
  };
};

export const updateGiftCommissionSettings = async (
  percent: unknown,
  adminUserId: string,
  persistence: GiftCommissionPersistence = defaultPersistence,
): Promise<GiftCommissionSettings> => {
  const rateBasisPoints = parseGiftCommissionPercent(percent);
  const client = await persistence.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1, 1)", [GIFT_COMMISSION_LOCK_NAMESPACE]);

    const previous = await client.query<{ value: unknown }>(
      `SELECT "value"
       FROM "wallet_settings"
       WHERE "key" = $1
       FOR UPDATE`,
      [GIFT_COMMISSION_SETTING_KEY],
    );
    const previousRateBasisPoints = getGiftCommissionRateBasisPoints(previous.rows[0]?.value);
    const updated = await client.query<{ updated_at: Date | string }>(
      `INSERT INTO "wallet_settings" ("key", "value", "updated_by", "updated_at")
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT ("key") DO UPDATE
       SET "value" = EXCLUDED."value",
           "updated_by" = EXCLUDED."updated_by",
           "updated_at" = now()
       RETURNING "updated_at"`,
      [
        GIFT_COMMISSION_SETTING_KEY,
        JSON.stringify({ commissionRateBasisPoints: rateBasisPoints, roundingMode: "floor" }),
        adminUserId,
      ],
    );

    await persistence.logAudit(
      {
        actorId: adminUserId,
        action: "gift_commission.updated",
        targetType: "site_setting",
        targetId: GIFT_COMMISSION_SETTING_KEY,
        metadata: {
          previousRateBasisPoints,
          commissionRateBasisPoints: rateBasisPoints,
          roundingMode: "floor",
        },
      },
      { queryExecutor: client, throwOnError: true },
    );

    await client.query("COMMIT");
    transactionStarted = false;
    return {
      configured: true,
      commissionRatePercent: rateBasisPoints / 100,
      roundingMode: "floor",
      updatedAt: new Date(updated.rows[0].updated_at).toISOString(),
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "gift commission update failed and rollback could not be confirmed",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
