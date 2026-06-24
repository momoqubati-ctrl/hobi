/**
 * Shared in-memory user store
 * يستخدم لتخزين بيانات المستخدمين (ضيوف وأعضاء في الذاكرة)
 * بحيث تكون متاحة من كل سياقات الخادم (HTTP و Socket)
 *
 * ملاحظة: يستخدم require + global لكسر عزلة Vite sandbox
 */

type SharedUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  countryCode: string;
  avatar: string;
  presence: string;
  connectedAt: string;
};

// استخدام global لكسر عزلة سياقات Vite المختلفة
const STORE_KEY = "__shared_user_store_v2__";

function getStore(): Map<string, SharedUser> {
  const g = global as any;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map<string, SharedUser>();
  }
  return g[STORE_KEY];
}

export const addSharedUser = (user: SharedUser) => {
  const store = getStore();
  store.set(user.id.toLowerCase(), user);
  store.set(user.username.toLowerCase(), user);
};

export const findSharedUser = (identifier: string): SharedUser | undefined => {
  const store = getStore();
  const norm = identifier.trim().toLowerCase();
  if (!norm) return undefined;
  const direct = store.get(norm);
  if (direct) return direct;
  for (const user of store.values()) {
    if (user.displayName.toLowerCase() === norm) return user;
  }
  return undefined;
};

export const removeSharedUser = (identifier: string) => {
  const store = getStore();
  store.delete(identifier.trim().toLowerCase());
};
