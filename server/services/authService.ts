import { createHmac, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { normalizeCountryCode } from "./countries";
import { AuthRole, createUserProfileDefaults, UserProfileDefaults } from "./userProfileDefaults";
import { canUseDatabaseAuth, createPersistedUser, findPersistedUserByUsername, PersistedUser } from "./userRepository";
import { addSharedUser } from "./sharedUserStore";
import { checkBan } from "./banCheck";
import { dbPool } from "../db";

type StoredUser = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  countryCode: string;
  profile: UserProfileDefaults;
  passwordHash?: string;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  username: string;
  name: string;
  role: AuthRole;
  countryCode: string;
} & UserProfileDefaults;

const usersByUsername = new Map<string, StoredUser>();

/** Look up an in-memory user by id, username, or displayName */
export const findInMemoryUser = (identifier: string): StoredUser | undefined => {
  const norm = identifier.trim().toLowerCase();
  if (!norm) return undefined;

  // search by username first
  const byUsername = usersByUsername.get(norm);
  if (byUsername) return byUsername;

  // search by id or displayName
  for (const user of usersByUsername.values()) {
    if (user.id.toLowerCase() === norm || user.displayName.toLowerCase() === norm) {
      return user;
    }
  }
  return undefined;
};

const DEFAULT_DEV_SECRET = "dev-only-change-this-secret";

if (process.env.NODE_ENV === "production" && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === DEFAULT_DEV_SECRET)) {
  console.error("[FATAL] AUTH_SECRET is not set or uses the default dev value in production. Shutting down.");
  process.exit(1);
}

const getSecret = () => {
  const secret = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret === DEFAULT_DEV_SECRET)) {
    throw new Error("[FATAL] AUTH_SECRET must be configured with a strong secret in production.");
  }
  return secret || DEFAULT_DEV_SECRET;
};

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const hashPassword = (password: string) => {
  const salt = randomUUID().replaceAll("-", "");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, storedHash: string) => {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const sign = (payload: string) => createHmac("sha256", getSecret()).update(payload).digest("base64url");

const toPublicUser = (user: StoredUser): PublicUser & { statusMsg: string } => ({
  id: user.id,
  username: user.username,
  name: user.displayName,
  role: user.role,
  countryCode: user.countryCode,
  ...user.profile,
  statusMsg: user.profile.profileMsg,
});

export const issueToken = (user: { id: string | number; username: string; role: string }) => {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: Date.now(),
      exp: Date.now() + 1000 * 60 * 60 * 24,
    }),
    "utf8",
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
};

const issueSession = (user: StoredUser) => {
  const publicUser = toPublicUser(user);
  return {
    token: issueToken(publicUser),
    user: publicUser,
  };
};

const persistedToStoredUser = (user: PersistedUser): StoredUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  countryCode: user.countryCode,
  profile: user.profile,
  passwordHash: user.passwordHash,
  createdAt: user.createdAt,
});

function storeDeviceInfo(userId: string, ip?: string, deviceFingerprint?: string, deviceSignature?: string) {
  if (!userId) return;
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (ip) {
    fields.push(`"ip" = $${idx++}`);
    values.push(ip);
  }
  if (deviceFingerprint) {
    fields.push(`"fp" = $${idx++}`);
    values.push(deviceFingerprint);
  }
  if (deviceSignature) {
    fields.push(`"device_signature" = $${idx++}`);
    values.push(deviceSignature);
  }
  if (fields.length === 0) return;

  values.push(userId);
  dbPool.query(
    `UPDATE "users" SET ${fields.join(", ")} WHERE "id" = $${idx} OR "uid" = $${idx} OR CAST("idreg" AS text) = $${idx}`,
    values,
  ).catch((err) => console.error("[authService] Failed to store device info:", err));
}

export const createGuestSession = async (displayName?: string, countryCode?: string, clientIp?: string, deviceFingerprint?: string, deviceSignature?: string) => {
  const rawName = displayName?.trim();
  if (!rawName) {
    throw Object.assign(new Error("يرجى إدخال اسم الزائر"), { code: "USERNAME_REQUIRED" });
  }
  const name = rawName.slice(0, 40);
  const normalizedCountryCode = normalizeCountryCode(countryCode);

  const banCheck = await checkBan({
    username: name,
    ip: clientIp,
    deviceFingerprint,
    deviceSignature,
  });
  if (banCheck.banned) {
    throw Object.assign(new Error("تم حظرك من الموقع"), { code: "BANNED" });
  }

  // 1. التحقق من أن الاسم غير مسجل لعضو في قاعدة البيانات
  if (canUseDatabaseAuth()) {
    const existingMember = await findPersistedUserByUsername(name);
    if (existingMember) {
      throw Object.assign(new Error("هذا الاسم موجود من سابق قم بادخال اسم اخر"), { code: "USERNAME_TAKEN" });
    }
    try {
      const { dbPool } = await import("../db");
      const res = await dbPool.query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(display_name) = LOWER($1) LIMIT 1`,
        [name]
      );
      if (res.rows.length > 0) {
        throw Object.assign(new Error("هذا الاسم موجود من سابق قم بادخال اسم اخر"), { code: "USERNAME_TAKEN" });
      }
    } catch (err: any) {
      if (err?.code === "USERNAME_TAKEN") throw err;
    }
  }

  if (usersByUsername.has(normalizeUsername(name))) {
    throw Object.assign(new Error("هذا الاسم موجود من سابق قم بادخال اسم اخر"), { code: "USERNAME_TAKEN" });
  }

  // 2. التحقق من أن الاسم غير متصل حالياً في الدردشة
  try {
    const { isUsernameOnline } = await import("../socket/presenceManager");
    const isOnline = await isUsernameOnline(name);
    if (isOnline) {
      throw Object.assign(new Error("هذا الاسم موجود من سابق قم بادخال اسم اخر"), { code: "USERNAME_TAKEN" });
    }
  } catch (err: any) {
    if (err?.code === "USERNAME_TAKEN") throw err;
  }

  const user: StoredUser = {
    id: randomUUID(),
    username: `guest-${randomUUID()}`,
    displayName: name,
    role: "guest",
    countryCode: normalizedCountryCode,
    profile: createUserProfileDefaults("guest"),
    createdAt: new Date().toISOString(),
  };
  storeDeviceInfo(user.id, clientIp, deviceFingerprint, deviceSignature);

  // تخزين الضيوف في الذاكرة لإتاحة فتح بروفايلهم لاحقاً
  usersByUsername.set(user.username, user);
  addSharedUser({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    countryCode: user.countryCode,
    avatar: user.profile.avatar || "/pic.png",
    presence: "online",
    connectedAt: user.createdAt,
  });

  return issueSession(user);
};

export const registerMember = async (input: { username: string; password: string; displayName?: string; countryCode?: string; clientIp?: string; deviceFingerprint?: string; deviceSignature?: string }) => {
  const username = normalizeUsername(input.username);
  const persistedUser = await findPersistedUserByUsername(username);
  if (persistedUser || usersByUsername.has(username)) {
    return {
      ok: false as const,
      code: "USERNAME_TAKEN",
      message: "اسم المستخدم مستخدم من قبل",
    };
  }

  const role: AuthRole = username === "admin" ? "owner" : "member";
  const normalizedCountryCode = normalizeCountryCode(input.countryCode);
  const profile = createUserProfileDefaults(role);
  const passwordHash = hashPassword(input.password);

  if (canUseDatabaseAuth()) {
    const persisted = await createPersistedUser({
      username,
      displayName: input.displayName?.trim().slice(0, 80) || input.username.trim().slice(0, 80),
      role,
      countryCode: normalizedCountryCode,
      passwordHash,
      profile,
    });

    if (persisted) {
      const storedUser = persistedToStoredUser(persisted);
      storeDeviceInfo(storedUser.id, input.clientIp, input.deviceFingerprint, input.deviceSignature);
      addSharedUser({
        id: storedUser.id,
        username: storedUser.username,
        displayName: storedUser.displayName,
        role: storedUser.role,
        countryCode: storedUser.countryCode,
        avatar: storedUser.profile.avatar || "/pic.png",
        presence: "online",
        connectedAt: storedUser.createdAt,
      });
      return {
        ok: true as const,
        session: issueSession(storedUser),
      };
    }
  }

  const user: StoredUser = {
    id: randomUUID(),
    username,
    displayName: input.displayName?.trim().slice(0, 80) || input.username.trim().slice(0, 80),
    role,
    countryCode: normalizedCountryCode,
    profile,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  usersByUsername.set(username, user);
  addSharedUser({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    countryCode: user.countryCode,
    avatar: user.profile.avatar || "/pic.png",
    presence: "online",
    connectedAt: user.createdAt,
  });
  return {
    ok: true as const,
    session: issueSession(user),
  };
};

export const loginMember = async (input: { username: string; password: string; countryCode?: string; clientIp?: string; deviceFingerprint?: string; deviceSignature?: string }) => {
  const username = normalizeUsername(input.username);

  const banCheck = await checkBan({
    username,
    ip: input.clientIp,
    deviceFingerprint: input.deviceFingerprint,
    deviceSignature: input.deviceSignature,
  });
  if (banCheck.banned) {
    return {
      ok: false as const,
      code: "BANNED",
      message: "تم حظرك من الموقع. لا يمكنك تسجيل الدخول.",
    };
  }

  // 1. Try database first
  const persisted = await findPersistedUserByUsername(username);
  if (persisted) {
    const user = persistedToStoredUser(persisted);
    if (!user.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      return {
        ok: false as const,
        code: "INVALID_CREDENTIALS",
        message: "اسم المستخدم أو كلمة المرور غير صحيحة",
      };
    }
    if (input.countryCode) {
      user.countryCode = normalizeCountryCode(input.countryCode);
    }
    // تحميل avatar_frame_url و member_card_bg_url والبنرات والأيقونات المهداة من user_profiles
    try {
      const profileResult = await dbPool.query(
        `SELECT "avatar_frame_url", "member_card_bg_url", "gifted_banner_url", "gifted_gift_icon_url", "gifted_promotion_icon_url" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
        [user.id]
      );
      if (profileResult.rows[0]) {
        const row = profileResult.rows[0];
        if (row.avatar_frame_url) user.profile.avatarFrameUrl = String(row.avatar_frame_url);
        if (row.member_card_bg_url) user.profile.memberCardBgUrl = String(row.member_card_bg_url);
        (user.profile as any).giftedBannerUrl = String(row.gifted_banner_url || "");
        (user.profile as any).giftedGiftIconUrl = String(row.gifted_gift_icon_url || "");
        (user.profile as any).giftedPromotionIconUrl = String(row.gifted_promotion_icon_url || "");
      }
    } catch (_) {}

    // تحميل أيقونة الصلاحية من user_role_assignments + roles
    try {
      const roleResult = await dbPool.query(
        `SELECT r.icon_url AS role_icon_url
         FROM user_role_assignments ura
         JOIN roles r ON r.id = ura.role_id AND r.is_active = true
         WHERE ura.user_id = $1
         ORDER BY r.rank DESC
         LIMIT 1`,
        [user.id]
      );
      if (roleResult.rows[0]?.role_icon_url) {
        (user.profile as any).roleIconUrl = String(roleResult.rows[0].role_icon_url).trim();
      }
    } catch (_) {}
    storeDeviceInfo(user.id, input.clientIp, input.deviceFingerprint, input.deviceSignature);
    return {
      ok: true as const,
      session: issueSession(user),
    };
  }

  // 2. DB unavailable – fall back to in-memory cache
  if (!canUseDatabaseAuth()) {
    const user = usersByUsername.get(username);
    if (user && user.passwordHash && verifyPassword(input.password, user.passwordHash)) {
      if (input.countryCode) {
        user.countryCode = normalizeCountryCode(input.countryCode);
      }
      storeDeviceInfo(user.id, input.clientIp, input.deviceFingerprint, input.deviceSignature);
      return {
        ok: true as const,
        session: issueSession(user),
      };
    }
  }

  // 3. User not found in DB (DB is working) or bad credentials
  return {
    ok: false as const,
    code: "INVALID_CREDENTIALS",
    message: "اسم المستخدم أو كلمة المرور غير صحيحة",
  };
};

export const updateInMemoryUserProfile = (username: string, updates: { avatar?: string; cover?: string; profileMsg?: string; displayName?: string; nameColor?: string; messageColor?: string; statusFontColor?: string }) => {
  const norm = normalizeUsername(username);
  const user = usersByUsername.get(norm);
  if (user) {
    if (updates.avatar !== undefined) user.profile.avatar = updates.avatar;
    if (updates.cover !== undefined) {
      user.profile.profileCover = updates.cover;
      user.profile.profileBannerUrl = updates.cover;
    }
    if (updates.profileMsg !== undefined) user.profile.profileMsg = updates.profileMsg;
    if (updates.displayName !== undefined) {
      user.displayName = updates.displayName;
    }
    if (updates.nameColor !== undefined) user.profile.nameColor = updates.nameColor;
    if (updates.messageColor !== undefined) user.profile.messageColor = updates.messageColor;
    if (updates.statusFontColor !== undefined) user.profile.statusFontColor = updates.statusFontColor;
    usersByUsername.set(norm, user);
    return user;
  }
  return null;
};

