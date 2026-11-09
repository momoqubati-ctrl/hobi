import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { test } from "node:test";
import {
  getSiteWalletBalance,
  SiteWalletFundingError,
  type SiteWalletFundingPersistence,
} from "../server/services/siteWalletFundingService";

const createPersistence = (rows: Array<{ balance_coins: string }>) => {
  const statements: string[] = [];
  let released = false;
  const client = {
    async query(text: string) {
      statements.push(text);
      return { rows };
    },
    release() {
      released = true;
    },
  } as unknown as PoolClient;
  const persistence: SiteWalletFundingPersistence = {
    connect: async () => client,
  };

  return { persistence, statements, wasReleased: () => released };
};

test("site-wallet balance reads the system inventory account and releases its connection", async () => {
  const { persistence, statements, wasReleased } = createPersistence([{ balance_coins: "2450" }]);

  const balance = await getSiteWalletBalance(persistence);

  assert.equal(balance, "2450");
  assert.ok(statements[0].includes('"account_type" = \'system\''));
  assert.ok(statements[0].includes('"bucket" = \'site_inventory\''));
  assert.equal(wasReleased(), true);
});

test("site-wallet balance rejects missing or invalid ledger account state", async () => {
  const missing = createPersistence([]);
  await assert.rejects(
    getSiteWalletBalance(missing.persistence),
    (error: unknown) =>
      error instanceof SiteWalletFundingError &&
      error.code === "LEDGER_ACCOUNT_NOT_INITIALIZED",
  );
  assert.equal(missing.wasReleased(), true);

  const invalid = createPersistence([{ balance_coins: "-1" }]);
  await assert.rejects(
    getSiteWalletBalance(invalid.persistence),
    (error: unknown) => error instanceof SiteWalletFundingError && error.code === "LEDGER_INCONSISTENT",
  );
  assert.equal(invalid.wasReleased(), true);
});
