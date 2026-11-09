import { dbPool } from "../db";
import {
  EphemeralPrivateMessageStore,
  type EphemeralPmSession,
  type EphemeralPmUser,
} from "./ephemeralPrivateMessageStore";

type Queryable = Pick<typeof dbPool, "query">;

export class PrivateMessageIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateMessageIdentityError";
  }
}

export type PrivateMessageIdentity = {
  id: string;
  uid: string;
  storageKey: string;
};

export type PrivateMessageUser = EphemeralPmUser & {
  nameColor: string;
  messageColor: string;
};

const getSharedStore = (): EphemeralPrivateMessageStore => {
  const proc = (typeof process !== "undefined" ? process : {}) as any;
  const glob = (typeof globalThis !== "undefined" ? globalThis : {}) as any;
  const nodeGlob = (typeof global !== "undefined" ? global : {}) as any;

  const existing =
    proc.__hobiEphemeralPrivateMessageStore__ ||
    glob.__hobiEphemeralPrivateMessageStore__ ||
    nodeGlob.__hobiEphemeralPrivateMessageStore__;

  if (existing) {
    Object.setPrototypeOf(existing, EphemeralPrivateMessageStore.prototype);
    proc.__hobiEphemeralPrivateMessageStore__ = existing;
    glob.__hobiEphemeralPrivateMessageStore__ = existing;
    nodeGlob.__hobiEphemeralPrivateMessageStore__ = existing;
    return existing;
  }

  const store = new EphemeralPrivateMessageStore();
  proc.__hobiEphemeralPrivateMessageStore__ = store;
  glob.__hobiEphemeralPrivateMessageStore__ = store;
  nodeGlob.__hobiEphemeralPrivateMessageStore__ = store;
  return store;
};

export const privateMessageStore = new Proxy({} as EphemeralPrivateMessageStore, {
  get(_target, prop, receiver) {
    const store = getSharedStore() as any;
    const value = Reflect.get(store, prop, receiver);
    return typeof value === "function" ? value.bind(store) : value;
  },
  set(_target, prop, value, receiver) {
    const store = getSharedStore() as any;
    return Reflect.set(store, prop, value, receiver);
  },
});

export const isEphemeralPrivateMessagingEnabled = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  if (environment.SOCKET_SHARD_ID?.trim()) return false;
  return environment.NODE_ENV !== "production" ||
    environment.PM_EPHEMERAL_SINGLE_PROCESS === "true";
};

export const registerPrivateMessageSession = (session: EphemeralPmSession): boolean =>
  isEphemeralPrivateMessagingEnabled() && privateMessageStore.registerSession(session);

export const endPrivateMessageSession = (
  sessionId: string,
  reason: "logout" | "expired" = "logout",
) => privateMessageStore.endSession(sessionId, reason);

export const resolveUserIdentity = async (
  rawId: string,
  database: Queryable = dbPool,
): Promise<PrivateMessageIdentity | null> => {
  const id = String(rawId || "").trim();
  if (!id) return null;

  const identityResult = await database.query(
    `SELECT id::text AS id, uid::text AS uid
     FROM users
     WHERE id::text = $1
        OR uid::text = $1
        OR idreg::text = $1
        OR lower(username) = lower($1)`,
    [id],
  );

  if (identityResult.rows.length > 1) {
    throw new PrivateMessageIdentityError("User identifier is ambiguous");
  }
  const user = identityResult.rows[0];
  if (!user) return null;

  const accountId = String(user.id || "");
  const uid = String(user.uid || accountId);
  if (!accountId) {
    throw new PrivateMessageIdentityError("Resolved user has no internal account ID");
  }

  return { id: accountId, uid, storageKey: uid };
};

export const resolvePrivateMessageUser = async (
  userId: string,
  database: Queryable = dbPool,
): Promise<PrivateMessageUser | null> => {
  const normalizedId = String(userId || "").trim();
  if (!normalizedId) return null;

  const result = await database.query(
    `SELECT u.id::text AS id,
            COALESCE(NULLIF(u.topic, ''), u.username) AS name,
            COALESCE(NULLIF(u.pic, ''), '/pic.png') AS avatar,
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, ''), '') AS name_color,
            COALESCE(NULLIF(up.message_color, ''), NULLIF(u.mcol, ''), '') AS message_color
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id::text = $1
        OR u.uid::text = $1
        OR u.idreg::text = $1
        OR lower(u.username) = lower($1)
     LIMIT 1`,
    [normalizedId],
  );
  const user = result.rows[0];
  if (user) {
    return {
      id: String(user.id),
      name: String(user.name || "عضو"),
      avatar: String(user.avatar || "/pic.png"),
      nameColor: String(user.name_color || ""),
      messageColor: String(user.message_color || ""),
    };
  }

  try {
    const { findInMemoryUser } = await import("./authService");
    const memUser = findInMemoryUser(normalizedId);
    if (memUser) {
      return {
        id: memUser.id,
        name: memUser.displayName || memUser.username || "عضو",
        avatar: memUser.profile?.avatar || "/pic.png",
        nameColor: memUser.profile?.nameColor || "",
        messageColor: memUser.profile?.messageColor || "",
      };
    }
  } catch {}

  return null;
};
