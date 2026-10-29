import test from "node:test";
import assert from "node:assert";
import { processText, setFilterAlertCallback } from "../server/services/filterService";

test("FilterService - should return original text when empty", async () => {
  const res = await processText({
    text: "",
    source: "room",
    user: { username: "user1", topic: "room:1", ip: "127.0.0.1" },
  });

  assert.strictEqual(res.filteredText, "");
  assert.strictEqual(res.hasMatch, false);
});

test("FilterService - setFilterAlertCallback works without throwing", () => {
  let callbackCalled = false;
  setFilterAlertCallback((data) => {
    callbackCalled = true;
  });

  assert.strictEqual(typeof setFilterAlertCallback, "function");
});
