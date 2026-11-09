export type GiftSendIntent = {
  giftId: string;
  receiverId: string;
  quantity: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "gift-send-pending-intents";

const readPendingIntents = (storage: StorageLike): Record<string, string> => {
  const serialized = storage.getItem(STORAGE_KEY);
  if (serialized === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("تعذر استعادة محاولة إرسال هدية سابقة");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("تعذر استعادة محاولة إرسال هدية سابقة");
  }

  const intents = parsed as Record<string, unknown>;
  for (const [intentKey, idempotencyKey] of Object.entries(intents)) {
    if (
      !intentKey ||
      typeof idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)
    ) {
      throw new Error("تعذر استعادة محاولة إرسال هدية سابقة");
    }
  }

  return intents as Record<string, string>;
};

const getIntentKey = ({ giftId, receiverId, quantity }: GiftSendIntent) =>
  JSON.stringify([giftId, receiverId, quantity]);

export const getGiftSendIdempotencyKey = (
  intent: GiftSendIntent,
  storage: StorageLike,
): string => {
  const pendingIntents = readPendingIntents(storage);
  const intentKey = getIntentKey(intent);
  const existingKey = pendingIntents[intentKey];
  if (existingKey) return existingKey;

  const idempotencyKey = crypto.randomUUID();
  pendingIntents[intentKey] = idempotencyKey;
  storage.setItem(STORAGE_KEY, JSON.stringify(pendingIntents));
  return idempotencyKey;
};

export const clearGiftSendIdempotencyKey = (
  intent: GiftSendIntent,
  idempotencyKey: string,
  storage: StorageLike,
): void => {
  const pendingIntents = readPendingIntents(storage);
  const intentKey = getIntentKey(intent);
  if (pendingIntents[intentKey] !== idempotencyKey) return;

  delete pendingIntents[intentKey];
  if (Object.keys(pendingIntents).length === 0) {
    storage.removeItem(STORAGE_KEY);
  } else {
    storage.setItem(STORAGE_KEY, JSON.stringify(pendingIntents));
  }
};
