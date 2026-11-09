import assert from "node:assert/strict";
import test from "node:test";
import { resolveInternalMailUserId } from "../server/services/internalMailService";

test("internal mail recipient aliases resolve to one canonical account ID", async () => {
  const resolvedId = await resolveInternalMailUserId("legacy-id", async () => ({
    rows: [{ user_id: "account-id" }],
  }));

  assert.equal(resolvedId, "account-id");
});

test("ambiguous internal mail recipient aliases are rejected", async () => {
  await assert.rejects(
    resolveInternalMailUserId("shared-legacy-id", async () => ({
      rows: [{ user_id: "account-a" }, { user_id: "account-b" }],
    })),
    /Ambiguous internal mail participant/,
  );
});
