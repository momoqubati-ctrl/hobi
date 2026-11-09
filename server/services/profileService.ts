import { db, dbPool } from "../db";
import { userProfiles, users, profileVisits, socialEdges } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { redis } from "./redis";
import { findInMemoryUser } from "./authService";
import { findSharedUser } from "./sharedUserStore";
import { normalizeMinioUrl } from "./minioClient";
import { isSystemOwnerUsername } from "./systemOwner";

type ProfileVisitor = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  visitedAt: string;
  hidden: boolean;
};

const localProfileVisits = new Map<string, ProfileVisitor[]>();
const localFollowEdges = new Set<string>();

const normalizeRole = (power: unknown, username: unknown) => {
  const value = String(power || "").toLowerCase();
  const user = String(username || "").toLowerCase();
  if (isSystemOwnerUsername(user)) return "owner";
  if (["owner", "ispower", "hide", "chatmaster"].includes(value)) return "admin";
  if (["admin", "moderator"].includes(value)) return value;
  return "member";
};

const toIsoDate = (value: unknown) => {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
};

const createLegacyProfileResult = (row: any) => {
  const userId = String(row.id || row.uid || row.idreg || "");
  const displayName = String(row.display_name || row.topic || row.username || "");

  return {
    id: userId,
    legacyId: row.idreg ?? null,
    username: String(row.username || ""),
    displayName,
    mentionName: String(row.mention_name || ""),
    publicUserId: String(row.public_user_id || ""),
    role: normalizeRole(row.power, row.username),
    status: "active",
    avatarUrl: normalizeMinioUrl(row.pic || "/pic.png"),
    coverUrl: row.pich || "/pich.png",
    countryCode: "SA",
    presence: "online",
    createdAt: toIsoDate(row.joinuser),
    updatedAt: toIsoDate(row.lastssen),
    profile: {
      userId,
      idreg: row.idreg ? `#${row.idreg}` : "",
      lid: String(row.lid || ""),
      uid: String(row.uid || row.id || ""),
      profileMsg: String(row.msg || ""),
      bio: "",
      mood: "",
      customStatus: "",
      stealth: false,
      youtubeUrl: String(row.youtub || ""),
      autoplayEnabled: false,
      avatarUrl: normalizeMinioUrl(row.pic || "/pic.png"),
      bannerUrl: row.pich || "/pich.png",
      themeId: String(row.them || ""),
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
      statusFontColor: String(row.scol || "#000000"),
      gradientColor: String(row.gcol || "#FFFFFF"),
      evaluation: Number(row.evaluation || 0),
      rep: Number(row.rep || 0),
      coins: Number(row.coins || 0),
      wallPostLikes: Number(row.wall_post_likes || 0),
      giftsReceivedCount: Number(row.gifts_received_count || 0),
      power: String(row.power || ""),
      icon: String(row.ico || ""),
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
      giftedBannerUrl: String(row.gifted_banner_url || ""),
      giftedGiftIconUrl: String(row.gifted_gift_icon_url || ""),
      giftedPromotionIconUrl: String(row.gifted_promotion_icon_url || ""),
      joinuser: Number(row.joinuser || Date.now()),
      updatedAt: toIsoDate(row.lastssen),
    },
  };
};

const findLegacyUserProfile = async (profileId: string) => {
  const normalized = String(profileId || "").trim();
  if (!normalized) return null;

const result = await dbPool.query(
      `SELECT u.*, 
              COALESCE(up.name_color, u.ucol) as ucol,
              COALESCE(up.message_color, u.mcol) as mcol,
              COALESCE(up.status_font_color, u.scol) as scol,
              COALESCE(up.avatar_url, u.pic) as pic,
              COALESCE(up.banner_url, u.pich) as pich,
              COALESCE(up.profile_msg, u.msg) as msg,
              up.gifted_banner_url,
              up.gifted_gift_icon_url,
              up.gifted_promotion_icon_url
       FROM users u
       LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
       WHERE CAST(u.uid AS text) = $1
          OR CAST(u.id AS text) = $1
          OR CAST(u.idreg AS varchar) = $1
          OR CONCAT('#', CAST(u.idreg AS varchar)) = $1
          OR lower(u.username) = lower($1)
          OR lower(u.display_name) = lower($1)
          OR lower(u.topic) = lower($1)
          OR lower(u.mention_name) = lower($1)
          OR CAST(u.public_user_id AS text) = $1
       LIMIT 1`,
      [normalized],
    );

  return result.rows[0] ? createLegacyProfileResult(result.rows[0]) : null;
};

const getLegacyProfileStats = async (profileId: string) => {
  const normalized = String(profileId || "").trim();
  if (!normalized) return null;

  const result = await dbPool.query(
    `SELECT rep, coins, evaluation, wall_post_likes, gifts_received_count
     FROM users
     WHERE CAST(uid AS text) = $1
        OR CAST(id AS text) = $1
        OR CAST(idreg AS varchar) = $1
        OR CONCAT('#', CAST(idreg AS varchar)) = $1
        OR lower(username) = lower($1)
        OR lower(display_name) = lower($1)
        OR lower(topic) = lower($1)
        OR lower(mention_name) = lower($1)
        OR CAST(public_user_id AS text) = $1
     LIMIT 1`,
    [normalized],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    views: Number(row.rep || 0),
    likes: Number(row.wall_post_likes || 0),
    coins: Number(row.coins || 0),
    evaluation: Number(row.evaluation || 0),
    giftsReceivedCount: Number(row.gifts_received_count || 0),
  };
};

const getFollowKey = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;

const addLocalProfileVisit = async (visitorId: string, profileId: string, hidden: boolean) => {
  if (visitorId === profileId) return;
  const visitorProfile = await findLegacyUserProfile(visitorId).catch(() => null);
  const visitor: ProfileVisitor = {
    id: visitorProfile?.id || visitorId,
    username: visitorProfile?.username || visitorId,
    displayName: visitorProfile?.displayName || visitorProfile?.username || visitorId,
    avatarUrl: visitorProfile?.profile?.avatarUrl || visitorProfile?.avatarUrl || "/pic.png",
    visitedAt: new Date().toISOString(),
    hidden,
  };

  const current = localProfileVisits.get(profileId) || [];
  localProfileVisits.set(profileId, [visitor, ...current.filter((item) => item.id !== visitor.id)].slice(0, 30));
};

export class ProfileService {
  /**
   * Record a profile visit and cache the view count.
   */
  static async recordVisit(visitorId: string, profileId: string, hidden: boolean = false) {
    if (visitorId === profileId) return; // Don't count self-views

    try {
      await addLocalProfileVisit(visitorId, profileId, hidden);

      const [visitor, profile] = await Promise.all([
        db.query.users.findFirst({ where: eq(users.id, visitorId) }),
        db.query.users.findFirst({ where: eq(users.id, profileId) }),
      ]);

      if (!visitor) {
        console.warn(`[ProfileService] visitor ${visitorId} missing; skipping visit record`);
        return;
      }
      if (!profile) {
        console.warn(`[ProfileService] profile ${profileId} missing; skipping visit record`);
        return;
      }

      await db.insert(profileVisits).values({
        visitorId,
        profileId,
        hiddenVisit: hidden,
      });

      if (!hidden) {
        await redis.client?.hincrby(`profile:stats:${profileId}`, "views", 1);
      }
    } catch (err) {
      console.error('[ProfileService] recordVisit error', err);
    }
  }

  /**
   * Get cached stats (views, followers, etc.)
   */
  static async getProfileStats(profileId: string) {
    const cachedStats = await redis.client?.hgetall(`profile:stats:${profileId}`);

    let baseStats: any;
    if (!cachedStats || Object.keys(cachedStats).length === 0) {
      try {
        const legacyStats = await getLegacyProfileStats(profileId);
        if (legacyStats) baseStats = legacyStats;
      } catch (error: any) {
        if (error?.code !== "42703" && error?.code !== "42P01") {
          console.error("[ProfileService] legacy stats lookup error", error);
        }
      }

      if (!baseStats) {
        const profileInfo = await db.query.userProfiles.findFirst({
          where: eq(userProfiles.userId, profileId),
        });
        baseStats = {
          views: profileInfo?.rep || 0,
          likes: profileInfo?.wallPostLikes || 0,
          coins: profileInfo?.coins || 0,
          evaluation: profileInfo?.evaluation || 0,
          giftsReceivedCount: profileInfo?.giftsReceivedCount || 0,
        };
      }
    } else {
      baseStats = {
        views: parseInt(cachedStats.views || "0", 10),
        likes: parseInt(cachedStats.likes || "0", 10),
        coins: parseInt(cachedStats.coins || "0", 10),
        evaluation: parseInt(cachedStats.evaluation || "0", 10),
        giftsReceivedCount: parseInt(cachedStats.giftsReceivedCount || "0", 10),
      };
    }

    let followersCount = 0;
    let followingCount = 0;
    let wallLikesCount = 0;
    try {
      const { dbPool } = await import("../db");
      const [fcRes, fgRes, wlRes] = await Promise.all([
        dbPool.query(`SELECT COUNT(*) as cnt FROM user_follows WHERE following_id = $1`, [String(profileId)]),
        dbPool.query(`SELECT COUNT(*) as cnt FROM user_follows WHERE follower_id = $1`, [String(profileId)]),
        dbPool.query(`SELECT COUNT(*) as cnt FROM bars_likes bl JOIN bars b ON bl.bar_id = b.id WHERE b.uid = $1`, [String(profileId)]),
      ]);
      followersCount = Number(fcRes.rows[0]?.cnt) || 0;
      followingCount = Number(fgRes.rows[0]?.cnt) || 0;
      wallLikesCount = Number(wlRes.rows[0]?.cnt) || 0;
    } catch {}

    return { ...baseStats, followersCount, followingCount, wallLikesCount };
  }

  static async addLike(viewerId: string, profileId: string) {
    const { dbPool } = await import("../db");

    const cooldownKey = `profile:like_cooldown:${viewerId}:${profileId}`;
    const redisCooldown = await redis.client?.get(cooldownKey);
    if (redisCooldown) {
      return { success: false, error: "يمكنك الإعجاب مرة كل دقيقة فقط" };
    }

    const dbCheck = await dbPool.query(
      `SELECT last_liked_at FROM profile_like_cooldowns WHERE liker_id = $1 AND profile_id = $2 LIMIT 1`,
      [String(viewerId), String(profileId)]
    );
    if (dbCheck.rows.length > 0) {
      const lastLikedAt = new Date(dbCheck.rows[0].last_liked_at).getTime();
      const now = Date.now();
      const diffSeconds = (now - lastLikedAt) / 1000;
      if (diffSeconds < 60) {
        return { success: false, error: "يمكنك الإعجاب مرة كل دقيقة فقط" };
      }
    }

    await dbPool.query(
      `UPDATE users SET wall_post_likes = COALESCE(wall_post_likes, 0) + 1
       WHERE CAST(id AS text) = $1 OR CAST(uid AS text) = $1`,
      [String(profileId)]
    );
    await redis.client?.hincrby(`profile:stats:${profileId}`, "likes", 1);

    await dbPool.query(
      `INSERT INTO profile_like_cooldowns (liker_id, profile_id, last_liked_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (liker_id, profile_id)
       DO UPDATE SET last_liked_at = NOW()`,
      [String(viewerId), String(profileId)]
    );
    await redis.client?.set(cooldownKey, "1", "EX", 60);

    let likesCount = 0;
    try {
      const cnt = await dbPool.query(
        `SELECT wall_post_likes FROM users WHERE CAST(id AS text) = $1 OR CAST(uid AS text) = $1 LIMIT 1`,
        [String(profileId)]
      );
      likesCount = Number(cnt.rows[0]?.wall_post_likes) || 0;
    } catch {}

    return { success: true, likesCount };
  }

  static async getLikeCooldown(viewerId: string, profileId: string) {
    const cooldownKey = `profile:like_cooldown:${viewerId}:${profileId}`;
    const redisTtl = await redis.client?.ttl(cooldownKey);
    if (redisTtl && redisTtl > 0) {
      return { cooldownRemaining: redisTtl };
    }

    try {
      const { dbPool } = await import("../db");
      const result = await dbPool.query(
        `SELECT last_liked_at FROM profile_like_cooldowns WHERE liker_id = $1 AND profile_id = $2 LIMIT 1`,
        [String(viewerId), String(profileId)]
      );
      if (result.rows.length > 0) {
        const lastLikedAt = new Date(result.rows[0].last_liked_at).getTime();
        const now = Date.now();
        const diffSeconds = Math.ceil((60000 - (now - lastLikedAt)) / 1000);
        if (diffSeconds > 0) {
          await redis.client?.set(cooldownKey, "1", "EX", diffSeconds);
          return { cooldownRemaining: diffSeconds };
        }
      }
    } catch {}

    return { cooldownRemaining: 0 };
  }

  static async toggleFollow(viewerId: string, profileId: string) {
    if (viewerId === profileId) {
      return { following: false, error: "Cannot follow yourself" };
    }

    const key = getFollowKey(viewerId, profileId);
    const { dbPool } = await import("../db");

    const existing = await dbPool.query(
      `SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1`,
      [String(viewerId), String(profileId)]
    );

    if (existing.rows.length > 0) {
      await dbPool.query(
        `DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
        [String(viewerId), String(profileId)]
      );
      localFollowEdges.delete(key);
    } else {
      await dbPool.query(
        `INSERT INTO user_follows (follower_id, following_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
        [String(viewerId), String(profileId)]
      );
      localFollowEdges.add(key);
    }

    const isFollowing = localFollowEdges.has(key);

    let followerCount = 0;
    try {
      const cnt = await dbPool.query(
        `SELECT COUNT(*) as cnt FROM user_follows WHERE following_id = $1`,
        [String(profileId)]
      );
      followerCount = Number(cnt.rows[0]?.cnt) || 0;
    } catch {}

    return { following: isFollowing, followerCount };
  }

  static async getRelationship(viewerId: string, profileId: string) {
    const likeCooldown = await this.getLikeCooldown(viewerId, profileId);

    if (viewerId === profileId) {
      return { isSelf: true, isFollowing: false, cooldownRemaining: likeCooldown.cooldownRemaining };
    }

    if (localFollowEdges.has(getFollowKey(viewerId, profileId))) {
      return { isSelf: false, isFollowing: true, cooldownRemaining: likeCooldown.cooldownRemaining };
    }

    try {
      const { dbPool } = await import("../db");
      const result = await dbPool.query(
        `SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1`,
        [String(viewerId), String(profileId)]
      );
      const isFollowing = result.rows.length > 0;
      if (isFollowing) localFollowEdges.add(getFollowKey(viewerId, profileId));
      return { isSelf: false, isFollowing, cooldownRemaining: likeCooldown.cooldownRemaining };
    } catch {
      return { isSelf: false, isFollowing: false, cooldownRemaining: likeCooldown.cooldownRemaining };
    }
  }

  static getVisitors(profileId: string) {
    return (localProfileVisits.get(profileId) || []).filter((visitor) => !visitor.hidden);
  }

  /**
   * Fetch a full user profile for display.
   */
  static async getFullProfile(userId: string) {
    try {
      const legacyProfile = await findLegacyUserProfile(userId);
      if (legacyProfile) return legacyProfile;
    } catch (error: any) {
      if (error?.code !== "42703" && error?.code !== "42P01") {
        console.error("[ProfileService] legacy profile lookup error", error);
      }
    }

    // Fallback to Drizzle
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      if (user) {
        const profile = await db.query.userProfiles.findFirst({
          where: eq(userProfiles.userId, userId),
        });
        return { ...user, profile };
      }
    } catch {}

    // Fallback to in-memory users
    const memUser = findInMemoryUser(userId);
    if (memUser) {
      return {
        id: memUser.id,
        username: memUser.username,
        displayName: memUser.displayName,
        role: memUser.role,
        avatarUrl: memUser.profile?.avatar || "/pic.png",
        coverUrl: memUser.profile?.profileCover || "/pich.png",
        countryCode: memUser.countryCode,
        presence: "online",
        createdAt: memUser.createdAt,
        updatedAt: memUser.createdAt,
        profile: memUser.profile || null,
      };
    }

    // Fallback to shared store (accessible across all contexts via globalThis)
    const shared = findSharedUser(userId);
    if (shared) {
      return {
        id: shared.id,
        username: shared.username,
        displayName: shared.displayName,
        role: shared.role,
        avatarUrl: shared.avatar || "/pic.png",
        coverUrl: "/pich.png",
        countryCode: shared.countryCode || "SA",
        presence: shared.presence || "online",
        createdAt: shared.connectedAt,
        updatedAt: shared.connectedAt,
        profile: null,
      };
    }

    return null;
  }
}
