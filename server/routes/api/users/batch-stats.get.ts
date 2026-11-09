import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { normalizeMinioUrl, normalizeOptionalMinioUrl } from "../../../services/minioClient";

type MemberStats = {
  avatar: string;
  cover: string;
  statusMsg: string;
  nameColor: string;
  avatarFrameUrl: string;
  giftedBannerUrl: string;
  giftedGiftIconUrl: string;
  giftedPromotionIconUrl: string;
  roleIconUrl: string;
  memberCardBgUrl: string;
  evaluation: number;
  rep: number;
  coins: number;
  likes: number;
  giftsReceivedCount: number;
  followerCount: number;
  followingCount: number;
  isFollowedByMe: boolean;
};

interface BatchStatsQueryExecutor {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
}

export function createBatchStatsHandler(database: BatchStatsQueryExecutor = dbPool) {
  return defineEventHandler(async (event) => {
    const query = getQuery(event);
    const userIds = query.ids as string;
    const currentUserId = query.currentUserId as string | undefined;

    if (!userIds) {
      setResponseStatus(event, 400);
      return { success: false, message: "ids مطلوب" };
    }

    const ids = userIds.split(",").filter(Boolean).slice(0, 30);

    try {
      const result = await database.query(
        `WITH follower_counts AS (
           SELECT following_id, COUNT(*) AS cnt
           FROM user_follows
           WHERE following_id = ANY($1::varchar[])
           GROUP BY following_id
         ),
         following_counts AS (
           SELECT follower_id, COUNT(*) AS cnt
           FROM user_follows
           WHERE follower_id = ANY($1::varchar[])
           GROUP BY follower_id
         )
         SELECT
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
           COALESCE(up.gifts_received_count, 0) as giftsReceivedCount,
           COALESCE(fc.cnt, 0) AS "followerCount",
           COALESCE(fgc.cnt, 0) AS "followingCount",
           CASE
             WHEN $2::varchar IS NULL THEN false
             ELSE EXISTS (
               SELECT 1
               FROM user_follows uf
               WHERE uf.follower_id = $2::varchar
                 AND uf.following_id = u.id
             )
           END AS "isFollowedByMe"
         FROM users u
         LEFT JOIN user_profiles up ON up.user_id = u.id
         LEFT JOIN follower_counts fc ON fc.following_id = u.id
         LEFT JOIN following_counts fgc ON fgc.follower_id = u.id
         WHERE u.id = ANY($1::varchar[])
         LIMIT 30`,
        [ids, currentUserId || null],
      );

      const statsMap: Record<string, MemberStats> = {};
      for (const row of result.rows) {
        const uid = String(row.id);
        statsMap[uid] = {
          avatar: normalizeMinioUrl(String(row.avatar)),
          cover: normalizeMinioUrl(String(row.cover)),
          statusMsg: String(row.statusMsg || ""),
          nameColor: String(row.nameColor || ""),
          avatarFrameUrl: normalizeOptionalMinioUrl(row.avatarFrameUrl),
          giftedBannerUrl: normalizeOptionalMinioUrl(row.giftedBannerUrl),
          giftedGiftIconUrl: normalizeOptionalMinioUrl(row.giftedGiftIconUrl),
          giftedPromotionIconUrl: normalizeOptionalMinioUrl(row.giftedPromotionIconUrl),
          roleIconUrl: normalizeOptionalMinioUrl(row.roleIconUrl),
          memberCardBgUrl: normalizeOptionalMinioUrl(row.memberCardBgUrl),
          evaluation: Number(row.evaluation) || 0,
          rep: Number(row.rep) || 0,
          coins: Number(row.coins) || 0,
          likes: Number(row.likes) || 0,
          giftsReceivedCount: Number(row.giftsReceivedCount) || 0,
          followerCount: Number(row.followerCount) || 0,
          followingCount: Number(row.followingCount) || 0,
          isFollowedByMe: row.isFollowedByMe === true,
        };
      }

      return { success: true, stats: statsMap };
    } catch (error) {
      console.error("Batch user stats error:", error);
      setResponseStatus(event, 500);
      return { success: false, message: "تعذر جلب بيانات الأعضاء" };
    }
  });
}

export default createBatchStatsHandler();
