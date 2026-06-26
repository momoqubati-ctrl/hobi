import { createHmac, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { normalizeCountryCode } from "./countries";
import { AuthRole, createUserProfileDefaults, UserProfileDefaults } from "./userProfileDefaults";
import { canUseDatabaseAuth, createPersistedUser, findPersistedUserByUsername, PersistedUser } from "./userRepository";
import { addSharedUser } from "./sharedUserStore";

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

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

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

const issueToken = (user: PublicUser) => {
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

export const createGuestSession = (displayName?: string, countryCode?: string) => {
  const name = displayName?.trim().slice(0, 40) || `زائر ${Math.floor(1000 + Math.random() * 9000)}`;
  const normalizedCountryCode = normalizeCountryCode(countryCode);

  const user: StoredUser = {
    id: randomUUID(),
    username: `guest-${randomUUID()}`,
    displayName: name,
    role: "guest",
    countryCode: normalizedCountryCode,
    profile: createUserProfileDefaults("guest"),
    createdAt: new Date().toISOString(),
  };

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

export const registerMember = async (input: { username: string; password: string; displayName?: string; countryCode?: string }) => {
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

export const loginMember = async (input: { username: string; password: string; countryCode?: string }) => {
  const username = normalizeUsername(input.username);

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

export const updateInMemoryUserProfile = (username: string, updates: { avatar?: string; cover?: string; profileMsg?: string; displayName?: string }) => {
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
      // تحديث خاصية name أيضاً إذا كانت public user
    }
    usersByUsername.set(norm, user);
    return user;
  }
  return null;
};

