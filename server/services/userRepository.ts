import { randomUUID } from "node:crypto";
import { dbPool } from "../db";
import { AuthRole, UserProfileDefaults } from "./userProfileDefaults";
import { normalizeMinioUrl } from "./minioClient";

export type PersistedUser = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  countryCode: string;
  passwordHash?: string;
  createdAt: string;
  profile: UserProfileDefaults;
};

type CreateUserInput = {
  username: string;
  displayName: string;
  role: AuthRole;
  countryCode: string;
  passwordHash: string;
  profile: UserProfileDefaults;
};

let databaseAvailable: boolean | undefined;

const normalizeRole = (power: string, username: string): AuthRole => {
  const value = String(power || "").toLowerCase();
  const user = String(username || "").toLowerCase();
  if (user === "admin" || user === "safarihost" || ["owner", "ispower", "hide", "chatmaster"].includes(value)) return "owner";
  if (["admin", "moderator"].includes(value)) return value as AuthRole;
  return "member";
};

const mapLegacyUser = (row: any): PersistedUser => {
  const role = normalizeRole(row.power, row.username);
  const idreg = Number(row.idreg || 0);
  const joinTime = Number(row.joinuser || row.lastssen || Date.now());
  return {
    id: String(row.id || row.uid || row.idreg),
    username: String(row.username || ""),
    displayName: String(row.topic || row.username || ""),
    role,
    countryCode: "SA",
    passwordHash: row.password || row.password_hash || undefined,
    createdAt: Number.isFinite(joinTime) ? new Date(joinTime).toISOString() : new Date().toISOString(),
    profile: {
      idreg: idreg ? `#${idreg}` : "",
      lid: String(row.lid || ""),
      uid: String(row.uid || row.id || ""),
      profileMsg: String(row.msg || ""),
      avatar: normalizeMinioUrl(String(row.pic || "/pic.png")),
      profileCover: normalizeMinioUrl(String(row.pich || "/pich.png")),
      profileBannerUrl: normalizeMinioUrl(String(row.pich || "/pich.png")),
      profileThemeId: String(row.them || ""),
      avatarFrameUrl: String(row.cover || ""),
      giftIconUrl: String(row.gift_ico || ""),
      memberCardBgUrl: "",
      profileIconUrl: String(row.ico || ""),
      nameGradient: "",
      nameEffectId: "",
      messageBubbleStyle: "default",
      profileAccentColor: "#2563EB",
      profileBackgroundUrl: String(row.cover || ""),
      backgroundColor: String(row.bg || "#FFFFFF"),
      messageColor: String(row.mcol || "#000000"),
      nameColor: String(row.ucol || "#000000"),
      gradientColor: String(row.gcol || "#FFFFFF"),
      evaluation: Number(row.evaluation || 0),
      rep: Number(row.rep || 0),
      coins: Number(row.coins || 0),
      wallPostLikes: Number(row.wall_post_likes || 0),
      giftsReceivedCount: Number(row.gifts_received_count || 0),
      power: String(row.power || ""),
      icon: String(row.ico || ""),
      giftIcon: String(row.gift_ico || ""),
      isLogin: "عضو",
      muted: Boolean(row.muted),
      documents: Boolean(row.documentationc),
      busy: false,
      alerts: true,
      nopmcall: false,
      nopmvideocall: false,
      roomId: "",
      siteBadgeId: String(row.site_badge_id || ""),
      siteBadge: String(row.site_badge || ""),
      joinuser: Number(row.joinuser || Date.now()),
    },
  };
};

const markDbUnavailable = (error: unknown) => {
  databaseAvailable = false;
  console.warn("Legacy users auth store unavailable, using in-memory fallback:", error instanceof Error ? error.message : error);
};

const resolveUserId = async (userId: string) => {
  const normalized = String(userId || "").trim();
  if (!normalized) return null;

  const result = await dbPool.query(
    `SELECT "id" FROM "users"
     WHERE CAST("uid" AS text) = $1
        OR CAST("id" AS text) = $1
        OR CAST("idreg" AS text) = $1
        OR lower("username") = lower($1)
     LIMIT 1`,
    [normalized],
  );

  return result.rows[0]?.id || normalized;
};

const syncProfileToCanonicalStore = async (
  userId: string,
  updates: {
    avatar?: string;
    cover?: string;
    profileMsg?: string;
    displayName?: string;
    nameColor?: string;
    messageColor?: string;
  },
) => {
  const actualUserId = await resolveUserId(userId);
  if (!actualUserId) return;

  const profileFields: string[] = [];
  const profileValues: unknown[] = [];
  const legacyFields: string[] = [];
  const legacyValues: unknown[] = [];
  let profileIndex = 1;
  let legacyIndex = 1;

  const addProfileField = (column: string, value: unknown) => {
    profileFields.push(`"${column}" = $${profileIndex++}`);
    profileValues.push(value);
  };

  const addLegacyField = (column: string, value: unknown) => {
    legacyFields.push(`"${column}" = $${legacyIndex++}`);
    legacyValues.push(value);
  };

  if (updates.avatar !== undefined) {
    addProfileField("avatar_url", updates.avatar);
    addLegacyField("pic", updates.avatar);
  }
  if (updates.cover !== undefined) {
    addProfileField("banner_url", updates.cover);
    addLegacyField("pich", updates.cover);
  }
  if (updates.profileMsg !== undefined) {
    addProfileField("profile_msg", updates.profileMsg);
    addLegacyField("msg", updates.profileMsg);
  }
  if (updates.displayName !== undefined) {
    addLegacyField("topic", String(updates.displayName).slice(0, 120));
  }
  if (updates.nameColor !== undefined) {
    addProfileField("name_color", updates.nameColor);
    addLegacyField("ucol", String(updates.nameColor).slice(0, 20));
  }
  if (updates.messageColor !== undefined) {
    addProfileField("message_color", updates.messageColor);
    addLegacyField("mcol", String(updates.messageColor).slice(0, 20));
  }

  if (profileFields.length > 0) {
    await dbPool.query(
      `INSERT INTO "user_profiles" ("user_id") VALUES ($1) ON CONFLICT ("user_id") DO NOTHING`,
      [actualUserId],
    );
    await dbPool.query(
      `UPDATE "user_profiles" SET ${profileFields.join(", ")} WHERE "user_id" = $${profileIndex}`,
      [...profileValues, actualUserId],
    );
  }

  if (legacyFields.length > 0) {
    await dbPool.query(
      `UPDATE "users" SET ${legacyFields.join(", ")} WHERE CAST("uid" AS text) = $${legacyIndex} OR CAST("id" AS text) = $${legacyIndex} OR CAST("idreg" AS text) = $${legacyIndex}`,
      [...legacyValues, actualUserId],
    );
  }
};

export const canUseDatabaseAuth = () => databaseAvailable !== false;

export const findPersistedUserByUsername = async (username: string): Promise<PersistedUser | null> => {
  if (databaseAvailable === false) return null;

  try {
    const result = await dbPool.query(
      `SELECT *
       FROM users
       WHERE lower(username) = lower($1)
       LIMIT 1`,
      [username],
    );
    databaseAvailable = true;
    return result.rows[0] ? mapLegacyUser(result.rows[0]) : null;
  } catch (error) {
    markDbUnavailable(error);
    return null;
  }
};

export const createPersistedUser = async (input: CreateUserInput): Promise<PersistedUser | null> => {
  if (databaseAvailable === false) return null;

  try {
    const now = Date.now();
    const uid = randomUUID().replaceAll("-", "").slice(0, 22);
    const lid = randomUUID().replaceAll("-", "").slice(0, 31);
    const token = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const inserted = await dbPool.query(
      `INSERT INTO users
        (id, display_name, bg, mcol, ucol, evaluation, ico, ip, fp, lid, uid, msg, pic, pich, power, rep, topic, username, password, them, cover, gift_ico, gcol, lastssen, joinuser, coins, site_badge_id, site_badge, wall_post_likes, gifts_received_count, muted, documentationc)
       VALUES
        (gen_random_uuid(), $4, '#FFFFFF', '#000000', '#000000', 0, '', '', '', $1, $2, '(عضو جديد)', '/pic.png', '/pich.png', $3, 0, $4, $5, $6, '', '', '', '#FFFFFF', $7, $7, 0, '', '', 0, 0, 0, false)
       RETURNING *`,
      [
        lid,
        uid,
        input.role === "owner" || input.role === "admin" ? "admin" : "",
        input.displayName,
        input.username,
        input.passwordHash,
        String(now),
      ],
    );
    databaseAvailable = true;

    await syncProfileToCanonicalStore(inserted.rows[0]?.id || inserted.rows[0]?.uid || input.username, {
      avatar: "/pic.png",
      cover: "/pich.png",
      profileMsg: "(عضو جديد)",
      displayName: input.displayName,
    });

    return mapLegacyUser(inserted.rows[0]);
  } catch (error) {
    markDbUnavailable(error);
    return null;
  }
};

export const updatePersistedUserProfile = async (
  userId: string,
  profileUpdates: {
    avatar?: string;
    cover?: string;
    profileMsg?: string;
    displayName?: string;
    nameColor?: string;
    messageColor?: string;
  }
): Promise<boolean> => {
  if (databaseAvailable === false) return false;

  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (profileUpdates.avatar !== undefined) {
      fields.push(`pic = $${paramIndex++}`);
      values.push(profileUpdates.avatar);
    }
    if (profileUpdates.cover !== undefined) {
      fields.push(`pich = $${paramIndex++}`);
      values.push(profileUpdates.cover);
    }
    if (profileUpdates.profileMsg !== undefined) {
      fields.push(`msg = $${paramIndex++}`);
      values.push(profileUpdates.profileMsg);
    }
    if (profileUpdates.displayName !== undefined) {
      fields.push(`topic = $${paramIndex++}`);
      values.push(String(profileUpdates.displayName).slice(0, 120));
    }
    if (profileUpdates.nameColor !== undefined) {
      fields.push(`ucol = $${paramIndex++}`);
      values.push(String(profileUpdates.nameColor).slice(0, 20));
    }
    if (profileUpdates.messageColor !== undefined) {
      fields.push(`mcol = $${paramIndex++}`);
      values.push(String(profileUpdates.messageColor).slice(0, 20));
    }

    if (fields.length === 0) return true;

    await syncProfileToCanonicalStore(userId, {
      avatar: profileUpdates.avatar,
      cover: profileUpdates.cover,
      profileMsg: profileUpdates.profileMsg,
      displayName: profileUpdates.displayName,
      nameColor: profileUpdates.nameColor,
      messageColor: profileUpdates.messageColor,
    });

    databaseAvailable = true;
    return true;
  } catch (error) {
    markDbUnavailable(error);
    return false;
  }
};

