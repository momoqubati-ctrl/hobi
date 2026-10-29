import { dbPool } from "../db";
import { normalizeMinioUrl } from "./minioClient";

const WALL_CACHE_TTL_MS = 30_000;
const WALL_CACHE_LIMIT = 50;
let cachedWallPosts: any[] | null = null;
let cachedWallPostsAt = 0;
let pendingWallPostsLoad: Promise<any[]> | null = null;

const normalizeAssetPath = (value?: string | null, fallback = "/pic.png") => {
  const path = String(value || "").trim();
  if (!path) return fallback;
  return normalizeMinioUrl(path);
};

const normalizeAuthorName = (value?: string | null) => {
  const name = String(value || "").trim();
  return name ? name.slice(0, 80) : "";
};

export const mapWallPost = (row: any) => {
  let mediaUrls: string[] | null = null;
  try {
    if (row.mediaUrls) {
      mediaUrls = typeof row.mediaUrls === "string" ? JSON.parse(row.mediaUrls) : row.mediaUrls;
      if (!Array.isArray(mediaUrls)) mediaUrls = null;
    }
  } catch {
    mediaUrls = null;
  }
  const normalizedMediaUrls = mediaUrls?.map((url) => normalizeAssetPath(url, "")) ??
    (row.mediaUrl ? [normalizeAssetPath(row.mediaUrl, "")] : null);

  let animatedFaces: string[] | null = null;
  try {
    if (row.animatedFaces) {
      animatedFaces = typeof row.animatedFaces === "string" ? JSON.parse(row.animatedFaces) : row.animatedFaces;
      if (!Array.isArray(animatedFaces)) animatedFaces = null;
    }
  } catch {
    animatedFaces = null;
  }

  return {
    id: String(row.id),
    body: row.body,
    mediaUrl: row.mediaUrl ? normalizeAssetPath(row.mediaUrl, "") : null,
    mediaUrls: normalizedMediaUrls,
    animatedFaces,
    createdAt: row.createdAt || new Date().toISOString(),
    author: {
      id: String(row.authorId || ""),
      name: row.authorName || row.fallbackAuthorName || row.authorId || "زائر",
      avatar: normalizeAssetPath(row.authorAvatar, "/pic.png"),
      nameColor: row.authorNameColor || "",
      giftedBannerUrl: normalizeAssetPath(row.authorGiftedBannerUrl, ""),
      giftedGiftIconUrl: normalizeAssetPath(row.authorGiftedGiftIconUrl, ""),
      giftedPromotionIconUrl: normalizeAssetPath(row.authorGiftedPromotionIconUrl, ""),
      roleIconUrl: normalizeAssetPath(row.authorRoleIconUrl, ""),
    },
  };
};

const setWallCache = (posts: any[]) => {
  cachedWallPosts = posts.slice(0, WALL_CACHE_LIMIT);
  cachedWallPostsAt = Date.now();
};

const isWallCacheFresh = () => cachedWallPosts && Date.now() - cachedWallPostsAt < WALL_CACHE_TTL_MS;

export const upsertCachedWallPost = (post: any) => {
  if (!post?.id) return;
  setWallCache([post, ...(cachedWallPosts || []).filter((item) => String(item.id) !== String(post.id))]);
};

export const listWallPosts = async () => {
  if (isWallCacheFresh()) {
    return cachedWallPosts!;
  }

  if (pendingWallPostsLoad) {
    return pendingWallPostsLoad;
  }

  pendingWallPostsLoad = (async () => {
    const result = await dbPool.query(`
      SELECT b.id, b.msg as body, b.pic as "mediaUrl", b.media_urls as "mediaUrls", b.animated_faces as "animatedFaces",
             b.uid as "authorId", b.topic as "fallbackAuthorName",
             COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as "authorName",
             NULLIF(u.pic, '') as "authorAvatar",
             COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as "authorNameColor",
             up.gifted_banner_url as "authorGiftedBannerUrl",
             up.gifted_gift_icon_url as "authorGiftedGiftIconUrl",
             up.gifted_promotion_icon_url as "authorGiftedPromotionIconUrl",
             (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as "authorRoleIconUrl"
      FROM bars b
      LEFT JOIN users u ON b.uid = u.uid OR b.uid = u.id OR b.uid = u.idreg::text OR lower(b.topic) = lower(u.username)
      LEFT JOIN user_profiles up ON up.user_id = u.id
      ORDER BY b.id DESC
      LIMIT 50
    `);
  
    const posts = result.rows.map(mapWallPost);
    setWallCache(posts);
    return posts;
  })();

  try {
    return await pendingWallPostsLoad;
  } finally {
    pendingWallPostsLoad = null;
  }
};

export const createWallPost = async (
  authorId: string,
  body: string,
  mediaUrl?: string,
  authorDisplayName?: string,
  authorRole?: string,
  animatedFaces?: string[],
) => {
  const isGuestAuthor = authorRole === "guest" || String(authorId).startsWith("guest-");
  const userRes = isGuestAuthor
    ? { rows: [] as any[] }
    : await dbPool.query(
        `SELECT u.uid, u.id, u.idreg, u.username, u.topic, u.pic,
                up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url
         FROM users u
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE CAST(u.uid AS text) = $1 OR CAST(u.id AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($1)
         LIMIT 1`,
        [authorId],
      );
  const user = userRes.rows[0];

  // Fetch role icon
  let authorRoleIconUrl = "";
  try {
    const roleRes = await dbPool.query(
      `SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = $1 ORDER BY r.rank DESC LIMIT 1`,
      [user?.id || authorId]
    );
    if (roleRes.rows[0]?.icon_url) authorRoleIconUrl = String(roleRes.rows[0].icon_url).trim();
  } catch (_) {}

  const legacyUserId = String(user?.uid || user?.id || user?.idreg || authorId);
  const authorName = normalizeAuthorName(isGuestAuthor ? authorDisplayName : user?.topic || user?.username || authorDisplayName) || authorId;

  const result = await dbPool.query(
    `INSERT INTO bars (uid, msg, pic, topic, animated_faces) 
     VALUES ($1, $2, $3, $4, $5) 
     RETURNING id, msg as body, pic as "mediaUrl", uid as "authorId", topic as "fallbackAuthorName", animated_faces as "animatedFaces"`,
    [legacyUserId, body, mediaUrl || null, authorName, animatedFaces && animatedFaces.length > 0 ? JSON.stringify(animatedFaces) : null]
  );
  
  const row = result.rows[0];
  const post = mapWallPost({
    ...row,
    authorName,
    authorAvatar: user?.pic,
    authorNameColor: user?.ucol || "",
    authorGiftedBannerUrl: user?.gifted_banner_url || "",
    authorGiftedGiftIconUrl: user?.gifted_gift_icon_url || "",
    authorGiftedPromotionIconUrl: user?.gifted_promotion_icon_url || "",
    authorRoleIconUrl,
    createdAt: new Date().toISOString(),
  });

  upsertCachedWallPost(post);
  return post;
};

export const updateCachedWallAuthorProfile = (
  identity: { userId?: string; username?: string },
  updates: { avatar?: string; nameColor?: string },
) => {
  if (!cachedWallPosts || (!updates.avatar && updates.nameColor === undefined)) return;

  const userId = String(identity.userId || "").trim();
  const username = String(identity.username || "").trim();

  cachedWallPosts = cachedWallPosts.map((post) => {
    const author = post.author || {};
    if (String(author.id) !== userId && String(author.name) !== username) return post;
    return {
      ...post,
      author: {
        ...author,
        ...(updates.avatar !== undefined ? { avatar: updates.avatar } : {}),
        ...(updates.nameColor !== undefined ? { nameColor: updates.nameColor } : {}),
      },
    };
  });
};

// ----- التعليقات الهرمية (Threaded Comments) -----

export const createWallComment = async (
  postId: string,
  authorId: string,
  authorName: string,
  body: string,
  parentId?: string,
) => {
  const userRes = await dbPool.query(
    `SELECT u.id, u.username, u.topic, u.pic,
            up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id::text = $1 OR u.idreg::text = $1 OR u.uid::text = $1 LIMIT 1`,
    [authorId],
  );
  const user = userRes.rows[0];
  const resolvedId = String(user?.id || authorId);
  const resolvedName = user?.topic || user?.username || authorName || "زائر";

  // Fetch role icon
  let authorRoleIconUrl = "";
  try {
    const roleRes = await dbPool.query(
      `SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = $1 ORDER BY r.rank DESC LIMIT 1`,
      [user?.id || authorId]
    );
    if (roleRes.rows[0]?.icon_url) authorRoleIconUrl = String(roleRes.rows[0].icon_url).trim();
  } catch (_) {}

  const result = await dbPool.query(
    `INSERT INTO bar_comments (bar_id, author_id, author_topic, author_pic, body, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, body, created_at as "createdAt"`,
    [parseInt(postId, 10), resolvedId, resolvedName, user?.pic || null, body, parentId ? parseInt(parentId, 10) : null],
  );

  const row = result.rows[0];
  return {
    id: String(row.id),
    body: row.body,
    createdAt: row.createdAt || new Date().toISOString(),
    author: {
      id: resolvedId,
      name: resolvedName,
      avatar: user?.pic ? normalizeAssetPath(user.pic, "/pic.png") : "/pic.png",
      nameColor: user?.ucol || "",
      giftedBannerUrl: user?.gifted_banner_url || "",
      giftedGiftIconUrl: user?.gifted_gift_icon_url || "",
      giftedPromotionIconUrl: user?.gifted_promotion_icon_url || "",
      roleIconUrl: authorRoleIconUrl,
    },
    parentId: parentId || null,
    replies: [],
  };
};

export const listPostComments = async (postId: string) => {
  const result = await dbPool.query(
    `SELECT bc.id, bc.body, COALESCE(bc.created_at, NOW()) as "createdAt",
            bc.author_topic as "authorName", bc.author_pic as "authorAvatar",
            bc.author_id as "authorId", bc.parent_id as "parentId",
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as "authorNameColor",
            up.gifted_banner_url as "authorGiftedBannerUrl",
            up.gifted_gift_icon_url as "authorGiftedGiftIconUrl",
            up.gifted_promotion_icon_url as "authorGiftedPromotionIconUrl",
            (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as "authorRoleIconUrl"
     FROM bar_comments bc
     LEFT JOIN users u ON u.id::text = bc.author_id::text
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE bc.bar_id = $1
     ORDER BY bc.id ASC`,
    [parseInt(postId, 10)],
  );

  const mapRow = (row: any) => ({
    id: String(row.id),
    body: row.body,
    createdAt: row.createdAt || new Date().toISOString(),
    author: {
      id: String(row.authorId || ""),
      name: row.authorName || "زائر",
      avatar: row.authorAvatar ? normalizeAssetPath(row.authorAvatar, "/pic.png") : "/pic.png",
      nameColor: row.authorNameColor || "",
      giftedBannerUrl: row.authorGiftedBannerUrl || "",
      giftedGiftIconUrl: row.authorGiftedGiftIconUrl || "",
      giftedPromotionIconUrl: row.authorGiftedPromotionIconUrl || "",
      roleIconUrl: row.authorRoleIconUrl || "",
    },
    parentId: row.parentId ? String(row.parentId) : null,
    replies: [] as any[],
  });

  const allComments = result.rows.map(mapRow);
  const commentMap = new Map<string, any>();
  const rootComments: any[] = [];

  for (const comment of allComments) {
    commentMap.set(comment.id, comment);
    if (!comment.parentId) {
      rootComments.push(comment);
    } else {
      const parent = commentMap.get(comment.parentId);
      if (parent) {
        parent.replies.push(comment);
      } else {
        rootComments.push(comment);
      }
    }
  }

  return rootComments;
};

export const deleteWallComment = async (commentId: string, authorId: string) => {
  const result = await dbPool.query(
    `DELETE FROM bar_comments WHERE id = $1 AND (author_id = $2 OR author_id IS NULL)
     RETURNING id`,
    [parseInt(commentId, 10), authorId],
  );
  return (result.rowCount ?? 0) > 0;
};

export const getCommentCounts = async (postIds: number[]) => {
  if (postIds.length === 0) return {};
  const placeholders = postIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await dbPool.query(
    `SELECT bar_id, COUNT(*)::int as count
     FROM bar_comments
     WHERE bar_id IN (${placeholders})
     GROUP BY bar_id`,
    postIds,
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[String(row.bar_id)] = row.count;
  }
  return counts;
};

// ----- الإعجابات (Likes) -----

export const toggleWallLike = async (postId: string, userId: string) => {
  const existing = await dbPool.query(
    "SELECT bar_id FROM bars_likes WHERE bar_id = $1 AND user_id = $2",
    [parseInt(postId, 10), userId],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    await dbPool.query("DELETE FROM bars_likes WHERE bar_id = $1 AND user_id = $2", [
      parseInt(postId, 10),
      userId,
    ]);
    return { liked: false };
  }

  await dbPool.query("INSERT INTO bars_likes (bar_id, user_id) VALUES ($1, $2)", [
    parseInt(postId, 10),
    userId,
  ]);
  return { liked: true };
};

export const getLikeCounts = async (postIds: number[]) => {
  if (postIds.length === 0) return {};
  const placeholders = postIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await dbPool.query(
    `SELECT bar_id, COUNT(*)::int as count
     FROM bars_likes
     WHERE bar_id IN (${placeholders})
     GROUP BY bar_id`,
    postIds,
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[String(row.bar_id)] = row.count;
  }
  return counts;
};

export const getUserLikedPosts = async (userId: string, postIds: number[]) => {
  if (postIds.length === 0) return new Set<string>();
  const placeholders = postIds.map((_, i) => `$${i + 2}`).join(",");
  const result = await dbPool.query(
    `SELECT bar_id FROM bars_likes WHERE user_id = $1 AND bar_id IN (${placeholders})`,
    [userId, ...postIds],
  );
  return new Set(result.rows.map((row: any) => String(row.bar_id)));
};

// ----- إعجابات التعليقات -----

export const toggleCommentLike = async (commentId: string, userId: string) => {
  const existing = await dbPool.query(
    "SELECT comment_id FROM bar_comment_likes WHERE comment_id = $1 AND user_id = $2",
    [parseInt(commentId, 10), userId],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    await dbPool.query("DELETE FROM bar_comment_likes WHERE comment_id = $1 AND user_id = $2", [
      parseInt(commentId, 10), userId,
    ]);
    return { liked: false };
  }

  await dbPool.query("INSERT INTO bar_comment_likes (comment_id, user_id) VALUES ($1, $2)", [
    parseInt(commentId, 10), userId,
  ]);
  return { liked: true };
};

export const getCommentLikeCounts = async (commentIds: number[]) => {
  if (commentIds.length === 0) return {};
  const placeholders = commentIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await dbPool.query(
    `SELECT comment_id, COUNT(*)::int as count
     FROM bar_comment_likes
     WHERE comment_id IN (${placeholders})
     GROUP BY comment_id`,
    commentIds,
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[String(row.comment_id)] = row.count;
  }
  return counts;
};

export const getUserLikedComments = async (userId: string, commentIds: number[]) => {
  if (commentIds.length === 0) return new Set<string>();
  const placeholders = commentIds.map((_, i) => `$${i + 2}`).join(",");
  const result = await dbPool.query(
    `SELECT comment_id FROM bar_comment_likes WHERE user_id = $1 AND comment_id IN (${placeholders})`,
    [userId, ...commentIds],
  );
  return new Set(result.rows.map((row: any) => String(row.comment_id)));
};
