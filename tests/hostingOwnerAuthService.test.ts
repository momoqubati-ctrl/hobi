import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { getResponseStatus, mockEvent } from "h3";
import { test } from "node:test";
import { getAdminContext, getUserAuthContext } from "../server/services/adminAccess";
import { issueAgentToken, issueHostingOwnerToken, verifyAuthToken } from "../server/services/authService";
import { hashAgentPassword } from "../server/services/agentAuthService";
import { authenticateHostingOwner } from "../server/services/hostingOwnerAuthService";
import { getHostingOwnerContext } from "../server/services/hostingOwnerAccess";
import authMeHandler from "../server/routes/api/auth/me.get";
import wallUploadHandler from "../server/routes/api/wall/upload.post";

const withHostingOwnerConfig = async (run: () => Promise<void>) => {
  const previousUsername = process.env.HOSTING_OWNER_USERNAME;
  const previousPasswordHash = process.env.HOSTING_OWNER_PASSWORD_HASH;
  process.env.HOSTING_OWNER_USERNAME = "site-host";
  process.env.HOSTING_OWNER_PASSWORD_HASH = hashAgentPassword("a-secure-host-password");
  try {
    await run();
  } finally {
    if (previousUsername === undefined) delete process.env.HOSTING_OWNER_USERNAME;
    else process.env.HOSTING_OWNER_USERNAME = previousUsername;
    if (previousPasswordHash === undefined) delete process.env.HOSTING_OWNER_PASSWORD_HASH;
    else process.env.HOSTING_OWNER_PASSWORD_HASH = previousPasswordHash;
  }
};

test("hosting owner receives a distinct, bounded signed session after valid login", async () => {
  await withHostingOwnerConfig(async () => {
    const result = await authenticateHostingOwner(" SITE-HOST ", "a-secure-host-password");
    const claims = verifyAuthToken(result.token);

    assert.equal(result.owner.username, "site-host");
    assert.equal(claims?.sub, "site-host");
    assert.equal(claims?.role, "hosting_owner");
    assert.equal(claims?.type, "hosting_owner");
    assert.equal(verifyAuthToken(result.token, (claims?.exp ?? 0) + 1), null);
  });
});

test("hosting owner login returns the same error for an incorrect username or password", async () => {
  await withHostingOwnerConfig(async () => {
    await assert.rejects(authenticateHostingOwner("someone-else", "a-secure-host-password"), {
      code: "INVALID_HOSTING_OWNER_CREDENTIALS",
    });
    await assert.rejects(authenticateHostingOwner("site-host", "wrong-password"), {
      code: "INVALID_HOSTING_OWNER_CREDENTIALS",
    });
  });
});

test("hosting owner auth fails closed when credentials are not configured", async () => {
  const previousUsername = process.env.HOSTING_OWNER_USERNAME;
  const previousPasswordHash = process.env.HOSTING_OWNER_PASSWORD_HASH;
  delete process.env.HOSTING_OWNER_USERNAME;
  delete process.env.HOSTING_OWNER_PASSWORD_HASH;

  try {
    await assert.rejects(authenticateHostingOwner("site-host", "a-secure-host-password"), {
      code: "HOSTING_OWNER_AUTH_NOT_CONFIGURED",
    });
  } finally {
    if (previousUsername !== undefined) process.env.HOSTING_OWNER_USERNAME = previousUsername;
    if (previousPasswordHash !== undefined) process.env.HOSTING_OWNER_PASSWORD_HASH = previousPasswordHash;
  }
});

test("hosting owner sessions cannot authenticate as regular members", () => {
  const token = issueHostingOwnerToken({ username: "site-host" });
  const event = mockEvent("/api/example", {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(getUserAuthContext(event).ok, false);
});

test("user authentication rejects tokens signed with the development fallback secret", () => {
  const previousSecret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  const payload = Buffer.from(JSON.stringify({
    sub: "forged-user",
    username: "forged-user",
    role: "admin",
    exp: Date.now() + 60_000,
  })).toString("base64url");
  const signature = createHmac("sha256", "dev-only-change-this-secret")
    .update(payload)
    .digest("base64url");
  const event = mockEvent("/api/admin/example", {
    headers: { authorization: `Bearer ${payload}.${signature}` },
  });

  try {
    assert.equal(getUserAuthContext(event).ok, false);
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});

test("member-context endpoint rejects hosting owner sessions before loading a user", async () => {
  const token = issueHostingOwnerToken({ username: "site-host" });
  const event = mockEvent("/api/auth/me", {
    headers: { authorization: `Bearer ${token}` },
  });

  const response = await authMeHandler(event);

  assert.equal(getResponseStatus(event), 401);
  assert.equal(response.success, false);
});

test("hosting owner sessions cannot authenticate as administrators", () => {
  const token = issueHostingOwnerToken({ username: "site-host" });
  const event = mockEvent("/api/admin/example", {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(getAdminContext(event).ok, false);
});

test("hosting owner access requires the portal key and a hosting-owner session", () => {
  const key = "a".repeat(43);
  const previousKey = process.env.HOSTING_OWNER_PORTAL_KEY;
  process.env.HOSTING_OWNER_PORTAL_KEY = key;

  try {
    const token = issueHostingOwnerToken({ username: "site-host" });
    const validEvent = mockEvent("/api/hosting-owner/fund", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-hosting-owner-portal-key": key,
      },
    });
    const invalidPortalEvent = mockEvent("/api/hosting-owner/fund", {
      headers: {
        authorization: `Bearer ${token}`,
        "x-hosting-owner-portal-key": "b".repeat(43),
      },
    });
    const agentEvent = mockEvent("/api/hosting-owner/fund", {
      headers: {
        authorization: `Bearer ${issueAgentToken({ id: "agent-1", username: "agent-one" })}`,
        "x-hosting-owner-portal-key": key,
      },
    });

    assert.deepEqual(getHostingOwnerContext(validEvent), {
      ok: true,
      id: "site-host",
      username: "site-host",
    });
    assert.equal(getHostingOwnerContext(invalidPortalEvent).statusCode, 404);
    assert.equal(getHostingOwnerContext(agentEvent).statusCode, 401);
  } finally {
    if (previousKey === undefined) delete process.env.HOSTING_OWNER_PORTAL_KEY;
    else process.env.HOSTING_OWNER_PORTAL_KEY = previousKey;
  }
});

test("wallet agents and hosting owners cannot upload wall media", async () => {
  const tokens = [
    issueAgentToken({ id: "agent-1", username: "agent-one" }),
    issueHostingOwnerToken({ username: "site-host" }),
  ];

  for (const token of tokens) {
    const event = mockEvent("/api/wall/upload", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });

    await wallUploadHandler(event);

    assert.equal(getResponseStatus(event), 401);
  }
});
