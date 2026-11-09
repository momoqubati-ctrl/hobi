import assert from "node:assert/strict";
import { getResponseHeader, getResponseStatus, mockEvent } from "h3";
import { test } from "node:test";
import { issueHostingOwnerToken } from "../server/services/authService";
import { createHostingOwnerSessionHandler } from "../server/routes/api/hosting-owner/auth/session.get";
import { createSiteWalletBalanceHandler } from "../server/routes/api/hosting-owner/balance.get";
import { SiteWalletFundingError } from "../server/services/siteWalletFundingService";

const portalKey = "a".repeat(43);
const ownerToken = issueHostingOwnerToken({ username: "site-host" });

const withPortalConfig = async (run: () => Promise<void>) => {
  const previous = process.env.HOSTING_OWNER_PORTAL_KEY;
  process.env.HOSTING_OWNER_PORTAL_KEY = portalKey;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.HOSTING_OWNER_PORTAL_KEY;
    else process.env.HOSTING_OWNER_PORTAL_KEY = previous;
  }
};

const makeEvent = (path: string, options: { token?: string; key?: string } = {}) =>
  mockEvent(path, {
    headers: {
      ...(options.key === undefined ? {} : { "x-hosting-owner-portal-key": options.key }),
      ...(options.token === undefined ? {} : { cookie: `hosting_owner_session=${options.token}` }),
    },
  });

test("hosting-owner session endpoint returns only the authenticated owner identity", async () => {
  await withPortalConfig(async () => {
    const handler = createHostingOwnerSessionHandler();
    const event = makeEvent("/api/hosting-owner/auth/session", { token: ownerToken, key: portalKey });

    const response = await handler(event);

    assert.deepEqual(response, {
      success: true,
      authenticated: true,
      owner: { username: "site-host" },
    });
    assert.equal(getResponseHeader(event, "Cache-Control"), "no-store");
  });
});

test("hosting-owner session endpoint rejects missing owner sessions and incorrect portal keys", async () => {
  await withPortalConfig(async () => {
    const handler = createHostingOwnerSessionHandler();
    const noSession = makeEvent("/api/hosting-owner/auth/session", { key: portalKey });
    const wrongKey = makeEvent("/api/hosting-owner/auth/session", {
      token: ownerToken,
      key: "b".repeat(43),
    });

    const noSessionResponse = await handler(noSession);
    await handler(wrongKey);

    assert.equal(getResponseStatus(noSession), 200);
    assert.deepEqual(noSessionResponse, {
      success: true,
      authenticated: false,
    });
    assert.equal(getResponseStatus(wrongKey), 404);
  });
});

test("site-wallet balance endpoint authenticates before reading the balance", async () => {
  await withPortalConfig(async () => {
    let readCount = 0;
    const handler = createSiteWalletBalanceHandler(async () => {
      readCount += 1;
      return "1250";
    });
    const event = makeEvent("/api/hosting-owner/balance", { token: ownerToken, key: portalKey });

    const response = await handler(event);

    assert.deepEqual(response, { success: true, balanceCoins: "1250" });
    assert.equal(getResponseStatus(event), 200);
    assert.equal(getResponseHeader(event, "Cache-Control"), "no-store");
    assert.equal(readCount, 1);
  });
});

test("site-wallet balance endpoint rejects unauthenticated reads before querying storage", async () => {
  await withPortalConfig(async () => {
    let readCount = 0;
    const handler = createSiteWalletBalanceHandler(async () => {
      readCount += 1;
      return "1250";
    });
    const event = makeEvent("/api/hosting-owner/balance", { key: portalKey });

    await handler(event);

    assert.equal(getResponseStatus(event), 401);
    assert.equal(readCount, 0);
  });
});

test("site-wallet balance endpoint reports uninitialized accounts without inventing a balance", async () => {
  await withPortalConfig(async () => {
    const handler = createSiteWalletBalanceHandler(async () => {
      throw new SiteWalletFundingError("LEDGER_ACCOUNT_NOT_INITIALIZED", "not initialized");
    });
    const event = makeEvent("/api/hosting-owner/balance", { token: ownerToken, key: portalKey });

    const response = await handler(event);

    assert.equal(getResponseStatus(event), 503);
    assert.deepEqual(response, {
      success: false,
      code: "LEDGER_ACCOUNT_NOT_INITIALIZED",
      message: "not initialized",
    });
  });
});
