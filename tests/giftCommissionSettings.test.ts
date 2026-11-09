import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import {
  calculateGiftCommissionCoins,
  parseGiftCommissionPercent,
  updateGiftCommissionSettings,
} from "../server/services/giftCommissionService";
import type { GiftCommissionPersistence } from "../server/services/giftCommissionService";

test("gift commission percentages are stored as exact basis points", () => {
  assert.equal(parseGiftCommissionPercent(0), 0);
  assert.equal(parseGiftCommissionPercent(7.25), 725);
  assert.equal(parseGiftCommissionPercent(100), 10_000);
});

test("gift commission rejects invalid percentages instead of applying a default", () => {
  for (const value of [-0.01, 100.01, 1.001, Number.NaN, Number.POSITIVE_INFINITY, "5"]) {
    assert.throws(() => parseGiftCommissionPercent(value), /نسبة العمولة غير صالحة/);
  }
});

test("gift commission rounds down to whole coins", () => {
  assert.equal(calculateGiftCommissionCoins(199n, 500), 9n);
  assert.equal(calculateGiftCommissionCoins(100n, 1), 0n);
  assert.equal(calculateGiftCommissionCoins(100n, 10_000), 100n);
});

test("saving a gift commission rate commits it together with its audit record", async () => {
  const statements: string[] = [];
  let auditMetadata: Record<string, unknown> | undefined;
  const client = {
    async query(text: string) {
      statements.push(text);
      if (text.includes('SELECT "value"')) {
        return { rows: [{ value: { commissionRateBasisPoints: 750 } }] };
      }
      if (text.includes('RETURNING "updated_at"')) {
        return { rows: [{ updated_at: new Date("2026-01-01T00:00:00.000Z") }] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const persistence: GiftCommissionPersistence = {
    connect: async () => client,
    logAudit: async (params) => {
      auditMetadata = params.metadata;
    },
  };

  const settings = await updateGiftCommissionSettings(5.5, "admin-1", persistence);

  assert.equal(settings.commissionRatePercent, 5.5);
  assert.equal(auditMetadata?.previousRateBasisPoints, 750);
  assert.equal(auditMetadata?.commissionRateBasisPoints, 550);
  assert.equal(statements.at(-1), "COMMIT");
});

test("a failed gift commission audit rolls back the setting update", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      if (text.includes('RETURNING "updated_at"')) {
        return { rows: [{ updated_at: new Date("2026-01-01T00:00:00.000Z") }] };
      }
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  const persistence: GiftCommissionPersistence = {
    connect: async () => client,
    logAudit: async () => {
      throw new Error("audit unavailable");
    },
  };

  await assert.rejects(updateGiftCommissionSettings(5, "admin-1", persistence), /audit unavailable/);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});
