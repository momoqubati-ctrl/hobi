import { randomUUID } from "node:crypto";
import { dbPool } from "../db";
import { AuthRole, UserProfileDefaults } from "./userProfileDefaults";

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
    id: String(row.uid || row.id || row.idreg),
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
      avatar: String(row.pic || "pic.png"),
      profileCover: String(row.pich || "pich.png"),
      profileBannerUrl: String(row.pich || "pich.png"),
      profileThemeId: String(row.them || ""),
      avatarFrameUrl: String(row.cover || ""),
      giftIconUrl: String(row.gift_ico || ""),
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
        (bg, mcol, ucol, evaluation, ico, ip, fp, id, lid, uid, msg, pic, pich, power, rep, topic, username, password, token, youtub, them, cover, "loginG", muted, documentationc, lastssen, joinuser, site_badge_id, site_badge, coins, gift_ico, gcol, last_eval_login_day, auto_power, wall_post_likes, gifts_received_count, eval_awards_json)
       VALUES
        ('#FFFFFF', '#000000', '#000000', 0, '', '', '', '', $1, $2, '(عضو جديد)', 'pic.png', 'pich.png', $3, 0, $4, $5, $6, $7, '', '', '', 0, 0, 0, $8, $8, '', '', 0, '', '#FFFFFF', '', '', 0, 0, NULL)
       RETURNING *`,
      [
        lid,
        uid,
        input.role === "owner" || input.role === "admin" ? "admin" : "",
        input.displayName,
        input.username,
        input.passwordHash,
        token,
        String(now),
      ],
    );
    databaseAvailable = true;
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

    if (fields.length === 0) return true;

    values.push(userId);
    const userIdParam = `$${paramIndex}`;

    // Checking both uid = userId and idreg = userId as legacy fallback
    const query = `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE uid = ${userIdParam} OR CAST(idreg AS VARCHAR) = ${userIdParam}
    `;

    await dbPool.query(query, values);
    databaseAvailable = true;
    return true;
  } catch (error) {
    markDbUnavailable(error);
    return false;
  }
};

