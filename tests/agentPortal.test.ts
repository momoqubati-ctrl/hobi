import assert from "node:assert/strict";
import { test } from "node:test";
import { getAgentPortalPath, isValidAgentPortalKey } from "../server/services/agentPortal";

test("agent portal paths are generated only from strong URL-safe keys", () => {
  const key = "a".repeat(43);

  assert.equal(getAgentPortalPath(key), `/agent/${key}`);
  assert.equal(getAgentPortalPath("short"), null);
  assert.equal(getAgentPortalPath("a".repeat(43) + "/extra"), null);
});

test("agent portal key validation rejects missing, malformed, and incorrect keys", () => {
  const key = "a".repeat(43);

  assert.equal(isValidAgentPortalKey(key, key), true);
  assert.equal(isValidAgentPortalKey("b".repeat(43), key), false);
  assert.equal(isValidAgentPortalKey(key, undefined), false);
  assert.equal(isValidAgentPortalKey("short", key), false);
});
