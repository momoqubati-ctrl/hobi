import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getSiteWalletFundingAttempt,
  type SiteWalletFundingAttempt,
} from "../src/lib/site-wallet-funding-intent";

const intent = {
  amountCoins: 250,
  externalReference: "Transfer-ABC-123",
};

test("retrying the same canonical funding request reuses its idempotency key", () => {
  const first = getSiteWalletFundingAttempt(intent, null, () => "attempt-1");
  const retry = getSiteWalletFundingAttempt(
    { ...intent, externalReference: " transfer-abc-123 " },
    first,
    () => "attempt-2",
  );

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
});

test("changing a funding request creates a new idempotency key", () => {
  const first = getSiteWalletFundingAttempt(intent, null, () => "attempt-1");
  const changed: SiteWalletFundingAttempt = getSiteWalletFundingAttempt(
    { ...intent, amountCoins: 300 },
    first,
    () => "attempt-2",
  );

  assert.equal(changed.idempotencyKey, "attempt-2");
});
