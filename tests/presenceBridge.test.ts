import assert from "node:assert/strict";
import test from "node:test";
import {
  getPresenceBridgeToken,
  isPresenceBridgeAuthorized,
} from "../server/socket/presenceBridge";

test("presence bridge accepts only the server-generated token", () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-presence-bridge-secret";

  try {
    const token = getPresenceBridgeToken();
    assert.equal(isPresenceBridgeAuthorized(token), true);
    assert.equal(isPresenceBridgeAuthorized(`${token}x`), false);
    assert.equal(isPresenceBridgeAuthorized(undefined), false);
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});

test("presence bridge fails closed without the server secret", () => {
  const previousSecret = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;

  try {
    assert.throws(() => getPresenceBridgeToken(), /AUTH_SECRET must be configured/);
    assert.equal(isPresenceBridgeAuthorized("any-token"), false);
  } finally {
    if (previousSecret !== undefined) process.env.AUTH_SECRET = previousSecret;
  }
});
