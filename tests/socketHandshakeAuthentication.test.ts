import assert from "node:assert/strict";
import test from "node:test";
import { getSocketAuthClaims } from "../server/socket/socketAuthentication";
import {
  issueAgentToken,
  issueHostingOwnerToken,
  issueToken,
} from "../server/services/authService";

test("socket identity comes only from a valid signed token", () => {
  const token = issueToken({
    id: "account-a",
    username: "member-a",
    role: "member",
  });

  const claims = getSocketAuthClaims({
    token,
    userId: "account-b",
    username: "administrator",
    role: "owner",
    idreg: "victim-legacy-id",
  });

  assert.equal(claims?.sub, "account-a");
  assert.equal(claims?.username, "member-a");
  assert.equal(claims?.role, "member");
});

test("socket handshake rejects missing and expired tokens", () => {
  const token = issueToken({
    id: "account-a",
    username: "member-a",
    role: "member",
  });

  assert.equal(getSocketAuthClaims({ userId: "account-a" }), null);
  assert.equal(getSocketAuthClaims({ token }, Date.now() + 25 * 60 * 60 * 1000), null);
});

test("socket handshake rejects non-user agent and hosting-owner tokens", () => {
  assert.equal(
    getSocketAuthClaims({
      token: issueAgentToken({ id: "agent-1", username: "agent-one" }),
    }),
    null,
  );
  assert.equal(
    getSocketAuthClaims({
      token: issueHostingOwnerToken({ username: "site-host" }),
    }),
    null,
  );
});
