import assert from "node:assert/strict";
import { getResponseHeader, getResponseStatus, mockEvent } from "h3";
import { test } from "node:test";
import { issueAgentToken, issueHostingOwnerToken } from "../server/services/authService";
import { createSiteWalletFundingHandler } from "../server/routes/api/hosting-owner/fund.post";
import {
  SiteWalletFundingError,
  type SiteWalletFundingInput,
  type SiteWalletFundingResult,
} from "../server/services/siteWalletFundingService";

const portalKey = "a".repeat(43);

const withPortalConfig = async (run: () => Promise<void>) => {
  const previous = {
    key: process.env.HOSTING_OWNER_PORTAL_KEY,
  };
  process.env.HOSTING_OWNER_PORTAL_KEY = portalKey;
  try {
    await run();
  } finally {
    if (previous.key === undefined) delete process.env.HOSTING_OWNER_PORTAL_KEY;
    else process.env.HOSTING_OWNER_PORTAL_KEY = previous.key;
  }
};

const makeEvent = (options: {
  body?: unknown;
  token?: string;
  key?: string;
  idempotencyKey?: string;
} = {}) => mockEvent("/api/hosting-owner/fund", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(options.key === undefined ? {} : { "x-hosting-owner-portal-key": options.key }),
    ...(options.token === undefined ? {} : { cookie: `hosting_owner_session=${options.token}` }),
    ...(options.idempotencyKey === undefined ? {} : { "idempotency-key": options.idempotencyKey }),
  },
  body: JSON.stringify(options.body ?? {}),
});

const successfulResult: SiteWalletFundingResult = {
  id: "funding-operation-1",
  amountCoins: 250,
  externalReference: "transfer-abc-123",
  siteWalletBalance: "750",
  createdAt: new Date("2026-10-31T12:00:00.000Z"),
  replayed: false,
};

test("site-wallet funding rejects missing or non-owner sessions before calling the ledger", async () => {
  await withPortalConfig(async () => {
    let calls = 0;
    const handler = createSiteWalletFundingHandler(async () => {
      calls += 1;
      return successfulResult;
    });

    for (const token of [undefined, issueAgentToken({ id: "agent-1", username: "agent-one" })]) {
      const event = makeEvent({
        body: { amountCoins: 250, externalReference: "transfer-abc-123" },
        token,
        key: portalKey,
        idempotencyKey: "funding-attempt-1",
      });
      await handler(event);
      assert.equal(getResponseStatus(event), 401);
    }

    assert.equal(calls, 0);
  });
});

test("site-wallet funding requires the correct private portal key", async () => {
  await withPortalConfig(async () => {
    let calls = 0;
    const handler = createSiteWalletFundingHandler(async () => {
      calls += 1;
      return successfulResult;
    });
    const event = makeEvent({
      body: { amountCoins: 250, externalReference: "transfer-abc-123" },
      token: issueHostingOwnerToken({ username: "site-host" }),
      key: "b".repeat(43),
      idempotencyKey: "funding-attempt-1",
    });

    await handler(event);

    assert.equal(getResponseStatus(event), 404);
    assert.equal(calls, 0);
  });
});

test("site-wallet funding rejects malformed requests and client-selected actor fields", async () => {
  await withPortalConfig(async () => {
    let calls = 0;
    const handler = createSiteWalletFundingHandler(async () => {
      calls += 1;
      return successfulResult;
    });
    const token = issueHostingOwnerToken({ username: "site-host" });

    for (const input of [
      { body: { amountCoins: 250, externalReference: "transfer-abc-123" } },
      { body: { amountCoins: -1, externalReference: "transfer-abc-123" }, idempotencyKey: "funding-attempt-1" },
      { body: { amountCoins: 250, externalReference: "transfer-abc-123", actorId: "attacker" }, idempotencyKey: "funding-attempt-1" },
    ]) {
      const event = makeEvent({
        ...input,
        token,
        key: portalKey,
      });
      await handler(event);
      assert.equal(getResponseStatus(event), 422);
    }
    assert.equal(calls, 0);
  });
});

test("site-wallet funding derives actor from the session and returns only the approved result", async () => {
  await withPortalConfig(async () => {
    let receivedInput: SiteWalletFundingInput | undefined;
    const handler = createSiteWalletFundingHandler(async (input) => {
      receivedInput = input;
      return successfulResult;
    });
    const event = makeEvent({
      body: { amountCoins: 250, externalReference: "Transfer-ABC-123" },
      token: issueHostingOwnerToken({ username: "site-host" }),
      key: portalKey,
      idempotencyKey: "funding-attempt-1",
    });

    const response = await handler(event);

    assert.deepEqual(receivedInput, {
      hostingOwnerUsername: "site-host",
      amountCoins: 250,
      externalReference: "Transfer-ABC-123",
      idempotencyKey: "funding-attempt-1",
    });
    assert.deepEqual(response, {
      success: true,
      id: successfulResult.id,
      amountCoins: successfulResult.amountCoins,
      externalReference: successfulResult.externalReference,
      siteWalletBalance: successfulResult.siteWalletBalance,
      createdAt: successfulResult.createdAt,
      replayed: false,
    });
    assert.equal("token" in response, false);
    assert.equal(getResponseHeader(event, "Cache-Control"), "no-store");
    assert.equal(getResponseHeader(event, "Referrer-Policy"), "no-referrer");
  });
});

test("site-wallet funding reports duplicate payment references as conflicts", async () => {
  await withPortalConfig(async () => {
    const handler = createSiteWalletFundingHandler(async () => {
      throw new SiteWalletFundingError("DUPLICATE_EXTERNAL_REFERENCE", "duplicate");
    });
    const event = makeEvent({
      body: { amountCoins: 250, externalReference: "Transfer-ABC-123" },
      token: issueHostingOwnerToken({ username: "site-host" }),
      key: portalKey,
      idempotencyKey: "funding-attempt-1",
    });

    const response = await handler(event);

    assert.equal(getResponseStatus(event), 409);
    assert.deepEqual(response, {
      success: false,
      code: "DUPLICATE_EXTERNAL_REFERENCE",
      message: "duplicate",
    });
  });
});
