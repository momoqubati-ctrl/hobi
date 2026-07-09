import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "127.0.0.1";
const MINIO_PORT = Number(process.env.MINIO_PORT) || 9000;
const MINIO_INTERNAL_HOSTS = [
  `http://127.0.0.1:${MINIO_PORT}`,
  `http://localhost:${MINIO_PORT}`,
];

function toProxyUrl(url: string): string {
  if (!url) return "/pic.png";
  const trimmed = url.trim();
  if (!trimmed) return "/pic.png";
  if (trimmed.startsWith("data:")) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `/${trimmed}`;
  }
  for (const host of MINIO_INTERNAL_HOSTS) {
    if (trimmed.startsWith(host)) {
      const key = trimmed.slice(host.length + 1).replace(/^\/+/, "");
      if (key) return `/minio/${key}`;
    }
  }
  return trimmed;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userIds = query.ids as string;
  const currentUserId = query.currentUserId as string | undefined;

  console.log("[batch-stats] userIds:", userIds, "currentUserId:", currentUserId);

  if (!userIds) {
    setResponseStatus(event, 400);
    return { success: false, message: "ids مطلوب" };
  }

  const ids = userIds.split(",").filter(Boolean).slice(0, 30);
  console.log("[batch-stats] parsed ids:", ids);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS "user_follows" (
      "follower_id" varchar(255) NOT NULL,
      "following_id" varchar(255) NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      PRIMARY KEY ("follower_id", "following_id")
    );
  `);

  try {
    const result = await dbPool.query(
      `SELECT 
        u.id,
        COALESCE(NULLIF(TRIM(up.avatar_url), ''), NULLIF(TRIM(u.pic), ''), '/pic.png') as avatar,
        COALESCE(NULLIF(TRIM(up.banner_url), ''), NULLIF(TRIM(u.pich), ''), NULLIF(TRIM(u.cover), ''), '/pich.png') as cover,
        COALESCE(NULLIF(TRIM(up.profile_msg), ''), NULLIF(TRIM(u.msg), ''), '') as statusMsg,
        COALESCE(NULLIF(TRIM(up.name_color), ''), NULLIF(TRIM(u.ucol), ''), '') as nameColor,
        COALESCE(NULLIF(TRIM(up.avatar_frame_url), ''), '') as avatarFrameUrl,
        COALESCE(NULLIF(TRIM(up.gifted_banner_url), ''), '') as giftedBannerUrl,
        COALESCE(NULLIF(TRIM(up.gifted_gift_icon_url), ''), '') as giftedGiftIconUrl,
        COALESCE(NULLIF(TRIM(up.gifted_promotion_icon_url), ''), '') as giftedPromotionIconUrl,
        (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as roleIconUrl,
        COALESCE(NULLIF(TRIM(up.member_card_bg_url), ''), '') as memberCardBgUrl,
        COALESCE(up.evaluation, 0) as evaluation,
        COALESCE(up.rep, 0) as rep,
        COALESCE(up.coins, 0) as coins,
        COALESCE(up.wall_post_likes, 0) as likes,
        COALESCE(up.gifts_received_count, 0) as giftsReceivedCount
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.id = ANY($1::varchar[])
      LIMIT 30`,
      [ids]
    );

    const followerCounts: Record<string, number> = {};
    const followingCounts: Record<string, number> = {};
    try {
      const fcResult = await dbPool.query(
        `SELECT following_id, COUNT(*) as cnt FROM user_follows WHERE following_id = ANY($1::varchar[]) GROUP BY following_id`,
        [ids]
      );
      console.log("[batch-stats] followerCounts rows:", fcResult.rows);
      for (const row of fcResult.rows) {
        followerCounts[String(row.following_id)] = Number(row.cnt);
      }
      const fgResult = await dbPool.query(
        `SELECT follower_id, COUNT(*) as cnt FROM user_follows WHERE follower_id = ANY($1::varchar[]) GROUP BY follower_id`,
        [ids]
      );
      console.log("[batch-stats] followingCounts rows:", fgResult.rows);
      for (const row of fgResult.rows) {
        followingCounts[String(row.follower_id)] = Number(row.cnt);
      }
    } catch (err) {
      console.error("[batch-stats] follower/following count query error:", err);
    }

    let followedByMe = new Set<string>();
    if (currentUserId) {
      try {
        const followResult = await dbPool.query(
          `SELECT following_id FROM user_follows WHERE follower_id = $1 AND following_id = ANY($2::varchar[])`,
          [String(currentUserId), ids]
        );
        console.log("[batch-stats] followedByMe rows:", followResult.rows, "currentUserId:", currentUserId);
        followedByMe = new Set(followResult.rows.map((r) => String(r.following_id)));
      } catch (err) {
        console.error("[batch-stats] followedByMe query error:", err);
      }
    }

    const statsMap: Record<string, any> = {};
    for (const row of result.rows) {
      const uid = String(row.id);
      statsMap[uid] = {
        avatar: toProxyUrl(String(row.avatar)),
        cover: toProxyUrl(String(row.cover)),
        statusMsg: String(row.statusMsg || ""),
        nameColor: String(row.nameColor || ""),
        avatarFrameUrl: toProxyUrl(String(row.avatarFrameUrl)),
        giftedBannerUrl: toProxyUrl(String(row.giftedBannerUrl)),
        giftedGiftIconUrl: toProxyUrl(String(row.giftedGiftIconUrl)),
        giftedPromotionIconUrl: toProxyUrl(String(row.giftedPromotionIconUrl)),
        roleIconUrl: toProxyUrl(String(row.roleIconUrl)),
        memberCardBgUrl: toProxyUrl(String(row.memberCardBgUrl)),
        evaluation: Number(row.evaluation) || 0,
        rep: Number(row.rep) || 0,
        coins: Number(row.coins) || 0,
        likes: Number(row.likes) || 0,
        giftsReceivedCount: Number(row.giftsReceivedCount) || 0,
        followerCount: followerCounts[uid] || 0,
        followingCount: followingCounts[uid] || 0,
        isFollowedByMe: followedByMe.has(uid),
      };
    }

    return { success: true, stats: statsMap };
  } catch (error) {
    console.error("Batch user stats error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب بيانات الأعضاء" };
  }
});
