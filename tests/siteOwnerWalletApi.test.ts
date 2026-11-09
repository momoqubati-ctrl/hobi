import assert from "node:assert/strict";
import { getResponseHeader, getResponseStatus, mockEvent } from "h3";
import { test } from "node:test";
import { issueHostingOwnerToken, issueToken } from "../server/services/authService";
import { createSiteOwnerWalletHandler } from "../server/routes/api/site-owner/wallet.get";
import { SiteWalletFundingError } from "../server/services/siteWalletFundingService";

const ownerToken = issueToken({ id: "site-owner-id", username: "site.owner", role: "__site_owner__" });

const withSiteOwnerConfig = async (run: () => Promise<void>) => {
  const previous = process.env.SITE_OWNER_USERNAME;
  process.env.SITE_OWNER_USERNAME = "site.owner";
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.SITE_OWNER_USERNAME;
    else process.env.SITE_OWNER_USERNAME = previous;
  }
};

const makeEvent = (token?: string) =>
  mockEvent("/api/site-owner/wallet", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

test("site-owner wallet endpoint returns the inventory balance only to the protected owner account", async () => {
  await withSiteOwnerConfig(async () => {
    let readCount = 0;
    const handler = createSiteOwnerWalletHandler(
      async () => {
        readCount += 1;
        return "1250";
      },
      async (userId, username) => userId === "site-owner-id" && username === "site.owner",
    );
    const event = makeEvent(ownerToken);

    const response = await handler(event);

    assert.deepEqual(response, { success: true, balanceCoins: "1250" });
    assert.equal(getResponseStatus(event), 200);
    assert.equal(getResponseHeader(event, "Cache-Control"), "no-store");
    assert.equal(getResponseHeader(event, "Referrer-Policy"), "no-referrer");
    assert.equal(readCount, 1);
  });
});

test("site-owner wallet endpoint rejects unauthenticated and non-owner sessions before reading the balance", async () => {
  await withSiteOwnerConfig(async () => {
    let readCount = 0;
    let authorizationCount = 0;
    const handler = createSiteOwnerWalletHandler(
      async () => {
        readCount += 1;
        return "1250";
      },
      async () => {
        authorizationCount += 1;
        return false;
      },
    );
    const noSession = makeEvent();
    const otherMember = makeEvent(issueToken({
      id: "member-id",
      username: "another.member",
      role: "member",
    }));

    await handler(noSession);
    const deniedResponse = await handler(otherMember);

    assert.equal(getResponseStatus(noSession), 401);
    assert.equal(getResponseStatus(otherMember), 403);
    assert.deepEqual(deniedResponse, {
      success: false,
      code: "SITE_OWNER_ACCESS_DENIED",
      message: "غير مصرح بعرض محفظة الموقع",
    });
    assert.equal(authorizationCount, 0);
    assert.equal(readCount, 0);
  });
});

test("site-owner wallet endpoint rejects hosting-owner sessions", async () => {
  await withSiteOwnerConfig(async () => {
    let readCount = 0;
    const handler = createSiteOwnerWalletHandler(
      async () => {
        readCount += 1;
        return "1250";
      },
      async () => true,
    );
    const event = makeEvent(issueHostingOwnerToken({ username: "site.owner" }));

    await handler(event);

    assert.equal(getResponseStatus(event), 401);
    assert.equal(readCount, 0);
  });
});

test("site-owner wallet endpoint denies the reserved username without the protected role assignment", async () => {
  await withSiteOwnerConfig(async () => {
    let readCount = 0;
    const handler = createSiteOwnerWalletHandler(
      async () => {
        readCount += 1;
        return "1250";
      },
      async () => false,
    );
    const event = makeEvent(ownerToken);

    await handler(event);

    assert.equal(getResponseStatus(event), 403);
    assert.equal(readCount, 0);
  });
});

test("site-owner wallet endpoint reports uninitialized inventory without inventing a balance", async () => {
  await withSiteOwnerConfig(async () => {
    const handler = createSiteOwnerWalletHandler(
      async () => {
        throw new SiteWalletFundingError("LEDGER_ACCOUNT_NOT_INITIALIZED", "not initialized");
      },
      async () => true,
    );
    const event = makeEvent(ownerToken);

    const response = await handler(event);

    assert.equal(getResponseStatus(event), 503);
    assert.deepEqual(response, {
      success: false,
      code: "LEDGER_ACCOUNT_NOT_INITIALIZED",
      message: "not initialized",
    });
  });
});
