import assert from "node:assert/strict";
import { getResponseStatus, mockEvent } from "h3";
import { test } from "node:test";
import agentInventoryOrders from "../server/routes/api/agents/inventory-orders/index.get";
import agentWallet from "../server/routes/api/agents/wallet.get";
import memberCoinPackages from "../server/routes/api/coin-purchases/agents.get";
import siteOwnerInventoryOrders from "../server/routes/api/site-owner/inventory-orders/index.get";

test("agent inventory endpoint requires the private portal key before reading orders", async () => {
  const previous = process.env.WALLET_AGENT_PORTAL_KEY;
  process.env.WALLET_AGENT_PORTAL_KEY = "a".repeat(40);
  try {
    const event = mockEvent("/api/agents/inventory-orders");
    const result = await agentInventoryOrders(event);

    assert.equal(getResponseStatus(event), 404);
    assert.equal(result.success, false);
  } finally {
    if (previous === undefined) delete process.env.WALLET_AGENT_PORTAL_KEY;
    else process.env.WALLET_AGENT_PORTAL_KEY = previous;
  }
});

test("agent wallet endpoint requires the private portal key before reading the balance", async () => {
  const previous = process.env.WALLET_AGENT_PORTAL_KEY;
  process.env.WALLET_AGENT_PORTAL_KEY = "a".repeat(40);
  try {
    const event = mockEvent("/api/agents/wallet");
    const result = await agentWallet(event);

    assert.equal(getResponseStatus(event), 404);
    assert.equal(result.success, false);
  } finally {
    if (previous === undefined) delete process.env.WALLET_AGENT_PORTAL_KEY;
    else process.env.WALLET_AGENT_PORTAL_KEY = previous;
  }
});

test("member package endpoint rejects unauthenticated callers before listing agents", async () => {
  const event = mockEvent("/api/coin-purchases/agents");
  const result = await memberCoinPackages(event);

  assert.equal(getResponseStatus(event), 401);
  assert.equal(result.success, false);
});

test("site-owner inventory endpoint rejects unauthenticated callers before listing orders", async () => {
  const event = mockEvent("/api/site-owner/inventory-orders");
  const result = await siteOwnerInventoryOrders(event);

  assert.equal(getResponseStatus(event), 401);
  assert.equal(result.success, false);
});
