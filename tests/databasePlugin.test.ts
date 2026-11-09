import assert from "node:assert/strict";
import { test } from "node:test";

test("database plugin can be imported without running initialization", async () => {
  await assert.doesNotReject(() => import("../server/plugins/database"));
});
