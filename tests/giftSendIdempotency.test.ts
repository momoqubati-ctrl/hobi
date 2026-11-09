import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearGiftSendIdempotencyKey,
  getGiftSendIdempotencyKey,
  type GiftSendIntent,
} from "../src/lib/gift-send-idempotency";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const intent: GiftSendIntent = {
  giftId: "gift-1",
  receiverId: "member-2",
  quantity: 1,
};

test("gift send retries reuse a persisted idempotency key", () => {
  const storage = new MemoryStorage();
  const firstKey = getGiftSendIdempotencyKey(intent, storage);
  const retryKey = getGiftSendIdempotencyKey(intent, storage);

  assert.equal(retryKey, firstKey);
});

test("successful gift sends clear only their matching pending intent", () => {
  const storage = new MemoryStorage();
  const key = getGiftSendIdempotencyKey(intent, storage);
  const otherIntent = { ...intent, receiverId: "member-3" };
  const otherKey = getGiftSendIdempotencyKey(otherIntent, storage);

  clearGiftSendIdempotencyKey(intent, key, storage);

  assert.notEqual(getGiftSendIdempotencyKey(intent, storage), key);
  assert.equal(getGiftSendIdempotencyKey(otherIntent, storage), otherKey);
});

test("corrupt pending gift intent data fails closed", () => {
  const storage = new MemoryStorage();
  storage.setItem("gift-send-pending-intents", "{invalid");

  assert.throws(() => getGiftSendIdempotencyKey(intent, storage));
});
