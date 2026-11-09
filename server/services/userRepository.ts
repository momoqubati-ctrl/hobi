import { randomUUID } from "node:crypto";
import { dbPool } from "../db";
import { AuthRole, UserProfileDefaults } from "./userProfileDefaults";
import { normalizeMinioUrl } from "./minioClient";
import { shouldAssignDefaultMemberRole } from "./defaultMemberRole";
import { isSystemOwnerUsername } from "./systemOwner";
import { generatePublicUserId, sanitizeMentionName } from "./publicIdService";

export type PersistedUser = {
  id: string;
  username: string;
  displayName: string;
  mentionName?: string;
  publicUserId?: string;
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
  const value = String(power || "").toLowerCase().trim();
  const user = String(username || "").toLowerCase().trim();
  if (isSystemOwnerUsername(user)) return "owner";
  if (["owner", "ispower", "hide", "chatmaster", "مالك"].includes(value)) return "admin";
  if (["admin", "ادمن", "أدمن"].includes(value)) return "admin";
  if (["moderator", "سوبر", "مشرف"].includes(value)) return "moderator";
  return "member";
};

const mapLegacyUser = (row: any): PersistedUser => {
  const role = normalizeRole(row.power, row.username);
  const idreg = Number(row.idreg || 0);
  const joinTime = Number(row.joinuser || row.lastssen || Date.now());
  return {
    id: String(row.id || row.uid || row.idreg),
    username: String(row.username || ""),
    displayName: String(row.display_name || row.topic || row.username || ""),
    mentionName: String(row.mention_name || ""),
    publicUserId: String(row.public_user_id || ""),
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
    statusFontColor?: string;
    youtubeUrl?: string;
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
  if (updates.mentionName !== undefined) {
    const cleanMention = updates.mentionName ? String(updates.mentionName).trim().slice(0, 32) : null;
    addLegacyField("mention_name", cleanMention);
  }
  if (updates.displayName !== undefined) {
    const cleanDisplay = String(updates.displayName).trim().slice(0, 120);
    addLegacyField("display_name", cleanDisplay);
    addLegacyField("topic", cleanDisplay);
  }
  if (updates.nameColor !== undefined) {
    addProfileField("name_color", updates.nameColor);
    addLegacyField("ucol", String(updates.nameColor).slice(0, 20));
  }
  if (updates.messageColor !== undefined) {
    addProfileField("message_color", updates.messageColor);
    addLegacyField("mcol", String(updates.messageColor).slice(0, 20));
  }
  if (updates.statusFontColor !== undefined) {
    addProfileField("status_font_color", updates.statusFontColor);
    addLegacyField("scol", String(updates.statusFontColor).slice(0, 20));
  }
  if (updates.youtubeUrl !== undefined) {
    addProfileField("youtube_url", updates.youtubeUrl);
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
    const publicUserId = generatePublicUserId();
    const mentionName = sanitizeMentionName(input.displayName || input.username);
    const inserted = await dbPool.query(
      `WITH inserted_user AS (
       INSERT INTO users
        (id, display_name, mention_name, public_user_id, bg, mcol, ucol, evaluation, ico, ip, fp, lid, uid, msg, pic, pich, power, rep, topic, username, password, them, cover, gift_ico, gcol, lastssen, joinuser, coins, site_badge_id, site_badge, wall_post_likes, gifts_received_count, muted, documentationc)
       VALUES
        (gen_random_uuid(), $4, $9, $10, '#FFFFFF', '#000000', '#000000', 0, '', '', '', $1, $2, '(عضو جديد)', '/pic.png', '/pich.png', $3, 0, $4, $5, $6, '', '', '', '#FFFFFF', $7, $7, 0, '', '', 0, 0, 0, false)
       RETURNING *
      ), default_role_assignment AS (
        INSERT INTO user_role_assignments (user_id, role_id, legacy_metadata)
        SELECT inserted_user.id::text, r.id, jsonb_build_object('source', 'default_member_signup')
        FROM inserted_user
        JOIN roles r ON r.is_default = true AND r.is_active = true
        WHERE $8::boolean
        ON CONFLICT (user_id, role_id) DO NOTHING
        RETURNING user_id
      )
      SELECT * FROM inserted_user`,
      [
        lid,
        uid,
        input.role === "owner" || input.role === "admin" ? "admin" : "",
        input.displayName,
        input.username,
        input.passwordHash,
        String(now),
        shouldAssignDefaultMemberRole(input.role),
        mentionName,
        publicUserId,
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
    statusFontColor?: string;
    youtubeUrl?: string;
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
    if (profileUpdates.mentionName !== undefined) {
      fields.push(`mention_name = ${paramIndex++}`);
      values.push(profileUpdates.mentionName ? String(profileUpdates.mentionName).trim().slice(0, 32) : null);
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
    if (profileUpdates.statusFontColor !== undefined) {
      fields.push(`scol = $${paramIndex++}`);
      values.push(String(profileUpdates.statusFontColor).slice(0, 20));
    }

    if (fields.length === 0) return true;

    await syncProfileToCanonicalStore(userId, {
      avatar: profileUpdates.avatar,
      cover: profileUpdates.cover,
      profileMsg: profileUpdates.profileMsg,
      displayName: profileUpdates.displayName,
      nameColor: profileUpdates.nameColor,
      messageColor: profileUpdates.messageColor,
      statusFontColor: profileUpdates.statusFontColor,
      youtubeUrl: profileUpdates.youtubeUrl,
    });

    databaseAvailable = true;
    return true;
  } catch (error) {
    markDbUnavailable(error);
    return false;
  }
};
