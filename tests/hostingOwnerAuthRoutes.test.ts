import assert from "node:assert/strict";
import { getResponseHeader, getResponseStatus, mockEvent } from "h3";
import { test } from "node:test";
import { hashAgentPassword } from "../server/services/agentAuthService";
import {
  issueHostingOwnerToken,
  issueToken,
  verifyAuthToken,
} from "../server/services/authService";
import { getHostingOwnerContext } from "../server/services/hostingOwnerAccess";
import hostingOwnerLoginHandler from "../server/routes/api/hosting-owner/auth/login.post";
import hostingOwnerLogoutHandler from "../server/routes/api/hosting-owner/auth/logout.post";
import { getRouteCategory, LIMITS } from "../server/middleware/rateLimiter";

const portalKey = "a".repeat(43);
const ownerPassword = "a-secure-host-password";
const ownerPasswordHash = hashAgentPassword(ownerPassword);

const withHostingOwnerConfig = async (run: () => Promise<void>) => {
  const previous = {
    portalKey: process.env.HOSTING_OWNER_PORTAL_KEY,
    username: process.env.HOSTING_OWNER_USERNAME,
    passwordHash: process.env.HOSTING_OWNER_PASSWORD_HASH,
  };
  process.env.HOSTING_OWNER_PORTAL_KEY = portalKey;
  process.env.HOSTING_OWNER_USERNAME = "site-host";
  process.env.HOSTING_OWNER_PASSWORD_HASH = ownerPasswordHash;

  try {
    await run();
  } finally {
    if (previous.portalKey === undefined) delete process.env.HOSTING_OWNER_PORTAL_KEY;
    else process.env.HOSTING_OWNER_PORTAL_KEY = previous.portalKey;
    if (previous.username === undefined) delete process.env.HOSTING_OWNER_USERNAME;
    else process.env.HOSTING_OWNER_USERNAME = previous.username;
    if (previous.passwordHash === undefined) delete process.env.HOSTING_OWNER_PASSWORD_HASH;
    else process.env.HOSTING_OWNER_PASSWORD_HASH = previous.passwordHash;
  }
};

const getCookieHeader = (event: ReturnType<typeof mockEvent>) => {
  const value = getResponseHeader(event, "set-cookie");
  return Array.isArray(value) ? value.join("; ") : String(value || "");
};

test("hosting-owner login rejects requests without the configured portal key", async () => {
  await withHostingOwnerConfig(async () => {
    const event = mockEvent("/api/hosting-owner/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "site-host", password: ownerPassword }),
    });

    await hostingOwnerLoginHandler(event);

    assert.equal(getResponseStatus(event), 404);
    assert.equal(getCookieHeader(event), "");
  });
});

test("hosting-owner login validates input and uses generic credential failures", async () => {
  await withHostingOwnerConfig(async () => {
    const invalidInputEvent = mockEvent("/api/hosting-owner/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosting-owner-portal-key": portalKey,
      },
      body: JSON.stringify({ username: "site-host" }),
    });
    await hostingOwnerLoginHandler(invalidInputEvent);
    assert.equal(getResponseStatus(invalidInputEvent), 422);

    const wrongUsernameEvent = mockEvent("/api/hosting-owner/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosting-owner-portal-key": portalKey,
      },
      body: JSON.stringify({ username: "someone-else", password: ownerPassword }),
    });
    const wrongPasswordEvent = mockEvent("/api/hosting-owner/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosting-owner-portal-key": portalKey,
      },
      body: JSON.stringify({ username: "site-host", password: "wrong-password" }),
    });
    const wrongUsername = await hostingOwnerLoginHandler(wrongUsernameEvent);
    const wrongPassword = await hostingOwnerLoginHandler(wrongPasswordEvent);

    assert.equal(getResponseStatus(wrongUsernameEvent), 401);
    assert.equal(getResponseStatus(wrongPasswordEvent), 401);
    assert.equal(wrongUsername.message, wrongPassword.message);
    assert.equal(getCookieHeader(wrongUsernameEvent), "");
  });
});

test("hosting-owner login sets a secure, bounded, HttpOnly session cookie without returning its token", async () => {
  await withHostingOwnerConfig(async () => {
    const event = mockEvent("/api/hosting-owner/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hosting-owner-portal-key": portalKey,
      },
      body: JSON.stringify({ username: " SITE-HOST ", password: ownerPassword }),
    });

    const response = await hostingOwnerLoginHandler(event);
    const cookie = getCookieHeader(event);
    const token = cookie.match(/hosting_owner_session=([^;]+)/)?.[1];

    assert.equal(getResponseStatus(event), 200);
    assert.equal(response.success, true);
    assert.deepEqual(response.owner, { username: "site-host" });
    assert.equal("token" in response, false);
    assert.ok(token);
    assert.equal(verifyAuthToken(token)?.type, "hosting_owner");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api\/hosting-owner/i);
    assert.match(cookie, /Max-Age=3600/i);
  });
});

test("hosting-owner logout clears the bounded session cookie", async () => {
  const event = mockEvent("/api/hosting-owner/auth/logout", { method: "POST" });

  const response = await hostingOwnerLogoutHandler(event);
  const cookie = getCookieHeader(event);

  assert.deepEqual(response, { success: true });
  assert.match(cookie, /hosting_owner_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/hosting-owner/i);
  assert.match(cookie, /Max-Age=0/i);
});

test("hosting-owner login uses the dedicated strict authentication rate-limit category", () => {
  assert.equal(getRouteCategory("/api/hosting-owner/auth/login"), "hosting_owner_auth");
  assert.deepEqual(LIMITS.hosting_owner_auth, { max: 10, windowMs: 15 * 60 * 1000 });
});

test("hosting-owner access rejects missing, expired, wrong-role, and wrong-portal sessions", async () => {
  await withHostingOwnerConfig(async () => {
    const makeEvent = (headers: Record<string, string> = {}) => mockEvent("/api/hosting-owner/fund", {
      headers: { "x-hosting-owner-portal-key": portalKey, ...headers },
    });

    assert.equal(getHostingOwnerContext(makeEvent()).statusCode, 401);
    assert.equal(
      getHostingOwnerContext(makeEvent({
        authorization: `Bearer ${issueToken({ id: "member-1", username: "member-one", role: "member" })}`,
      })).statusCode,
      401,
    );
    assert.equal(
      getHostingOwnerContext(makeEvent({ "x-hosting-owner-portal-key": "b".repeat(43) })).statusCode,
      404,
    );

    const currentTime = Date.now;
    let expiredToken = "";
    try {
      Date.now = () => currentTime() - 2 * 60 * 60 * 1000;
      expiredToken = issueHostingOwnerToken({ username: "site-host" });
    } finally {
      Date.now = currentTime;
    }

    const expiredEvent = makeEvent({ cookie: `hosting_owner_session=${expiredToken}` });
    assert.equal(getHostingOwnerContext(expiredEvent).statusCode, 401);
  });
});
