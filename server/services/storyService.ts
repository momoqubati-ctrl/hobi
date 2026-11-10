import { db, dbPool } from "../db";
import { stories, storyViews, storyReactions } from "../db/schema";
import { eq, and, gt, desc, sql } from "drizzle-orm";
import { eventBus } from "../core/events/EventBus";
import { normalizeMinioUrl } from "./minioClient";

function normalizeAvatarUrl(url: string | null | undefined): string {
  return normalizeMinioUrl(url || "");
}

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export type StoryInput = {
  authorId: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "text";
  caption?: string;
  linkUrl?: string;
  bgColor?: string;
  textColor?: string;
};

export type StoryRow = {
  id: string;
  authorId: string;
  mediaUrl: string | null;
  mediaType: string;
  caption: string | null;
  linkUrl: string | null;
  bgColor: string;
  textColor: string;
  isActive: boolean;
  viewCount: number;
  likeCount: number;
  giftCount: number;
  shareCount: number;
  createdAt: string;
  expiresAt: string;
};

export async function createStory(input: StoryInput): Promise<StoryRow> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STORY_TTL_MS);

  const [row] = await db.insert(stories).values({
    authorId: input.authorId,
    mediaUrl: input.mediaUrl || null,
    mediaType: input.mediaType || "text",
    caption: input.caption || null,
    linkUrl: input.linkUrl || null,
    bgColor: input.bgColor || "linear-gradient(135deg,#667eea,#764ba2)",
    textColor: input.textColor || "#ffffff",
    expiresAt,
  }).returning();

  eventBus.publish({
    type: "story.created",
    stream: "stories",
    actor: { username: input.authorId, role: "member" },
    target: { id: row.id, type: "story" },
    payload: { storyId: row.id, authorId: input.authorId },
    metadata: { source: "storyService.createStory" },
  }).catch(() => {});

  return row;
}

export async function getActiveStories(currentUserId?: string): Promise<any[]> {
  const result = await dbPool.query(`
    SELECT
      s.*,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), LEFT(s.author_id, 12)) AS author_username,
      COALESCE(u.role, 'guest') AS author_role,
      COALESCE(u.pic, '/pic.png') AS author_avatar,
      u.cover AS author_cover,
      COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) AS author_name_color,
      COALESCE(uv.viewed, false) AS viewed_by_me,
      COALESCE(ul.liked, false) AS liked_by_me,
      COALESCE(uf.followed, false) AS followed_by_me
    FROM stories s
    LEFT JOIN users u ON u.id = s.author_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT true AS viewed
      FROM story_views sv
      WHERE sv.story_id = s.id AND sv.viewer_id = $1
      LIMIT 1
    ) uv ON true
    LEFT JOIN LATERAL (
      SELECT true AS liked
      FROM story_reactions sr
      WHERE sr.story_id = s.id AND sr.user_id = $1
      LIMIT 1
    ) ul ON true
    LEFT JOIN LATERAL (
      SELECT true AS followed
      FROM user_follows uf
      WHERE uf.follower_id = $1 AND uf.following_id = s.author_id
      LIMIT 1
    ) uf ON true
    WHERE s.is_active = true AND s.expires_at > NOW()
    ORDER BY s.created_at DESC
  `, [currentUserId || ""]);

  // DEBUG: log raw pic values for diagnosis
  if (result.rows.length > 0) {
    const samples = result.rows.slice(0, 3).map((r: any) => ({
      author_id: r.author_id,
      raw_pic: r.pic,
      raw_author_avatar: r.author_avatar,
    }));
    console.log("[Stories DEBUG] raw pic values from DB:", JSON.stringify(samples));
  }

  return result.rows.map(normalizeStoryRow);
}

export async function getUserStories(userId: string, currentViewerId?: string): Promise<any[]> {
  const result = await dbPool.query(`
    SELECT
      s.*,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), LEFT(s.author_id, 12)) AS author_username,
      COALESCE(u.role, 'guest') AS author_role,
      COALESCE(u.pic, '/pic.png') AS author_avatar,
      u.cover AS author_cover,
      COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) AS author_name_color,
      COALESCE(uv.viewed, false) AS viewed_by_me,
      COALESCE(ul.liked, false) AS liked_by_me,
      COALESCE(uf.followed, false) AS followed_by_me
    FROM stories s
    LEFT JOIN users u ON u.id = s.author_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT true AS viewed
      FROM story_views sv
      WHERE sv.story_id = s.id AND sv.viewer_id = $1
      LIMIT 1
    ) uv ON true
    LEFT JOIN LATERAL (
      SELECT true AS liked
      FROM story_reactions sr
      WHERE sr.story_id = s.id AND sr.user_id = $1
      LIMIT 1
    ) ul ON true
    LEFT JOIN LATERAL (
      SELECT true AS followed
      FROM user_follows uf
      WHERE uf.follower_id = $1 AND uf.following_id = s.author_id
      LIMIT 1
    ) uf ON true
    WHERE s.author_id = $2 AND s.is_active = true AND s.expires_at > NOW()
    ORDER BY s.created_at DESC
  `, [currentViewerId || "", userId]);

  return result.rows.map(normalizeStoryRow);
}

export async function getStoryById(storyId: string): Promise<any | null> {
  const result = await dbPool.query(`
    SELECT
      s.*,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), LEFT(s.author_id, 12)) AS author_username,
      COALESCE(u.role, 'guest') AS author_role,
      COALESCE(u.pic, '/pic.png') AS author_avatar,
      u.cover AS author_cover,
      COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) AS author_name_color
    FROM stories s
    LEFT JOIN users u ON u.id = s.author_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE s.id = $1
    LIMIT 1
  `, [storyId]);

  return result.rows[0] ? normalizeStoryRow(result.rows[0]) : null;
}

export async function deleteStory(storyId: string, userId: string): Promise<boolean> {
  const result = await db.update(stories)
    .set({ isActive: false })
    .where(and(eq(stories.id, storyId), eq(stories.authorId, userId)))
    .returning();

  if (result.length > 0) {
    eventBus.publish({
      type: "story.deleted",
      stream: "stories",
      actor: { username: userId, role: "member" },
      target: { id: storyId, type: "story" },
      payload: { storyId },
      metadata: { source: "storyService.deleteStory" },
    }).catch(() => {});
    return true;
  }
  return false;
}

export async function markStoryViewed(storyId: string, viewerId: string, viewerName?: string): Promise<boolean> {
  const existing = await db.select()
    .from(storyViews)
    .where(and(eq(storyViews.storyId, storyId), eq(storyViews.viewerId, viewerId)))
    .limit(1);

  if (existing.length > 0) return false;

  await db.insert(storyViews).values({ storyId, viewerId, viewerName });

  await db.update(stories)
    .set({ viewCount: sql`view_count + 1` })
    .where(eq(stories.id, storyId));

  return true;
}

export async function getStoryViewers(storyId: string): Promise<any[]> {
  const result = await dbPool.query(`
    SELECT sv.viewer_id AS id, sv.viewed_at,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), sv.viewer_name, 'زائر') AS username,
      COALESCE(u.pic, '/pic.png') AS avatar
    FROM story_views sv
    LEFT JOIN users u ON u.id = sv.viewer_id
    WHERE sv.story_id = $1
    ORDER BY sv.viewed_at DESC
  `, [storyId]);

  return result.rows.map((r: any) => ({
    id: r.id,
    username: r.username,
    avatar: normalizeAvatarUrl(r.avatar),
    viewedAt: r.viewed_at,
  }));
}

export async function getStoryReactions(storyId: string, type: string = "like"): Promise<any[]> {
  const result = await dbPool.query(`
    SELECT sr.user_id AS id, sr.created_at,
      COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), sr.user_name, 'زائر') AS username,
      COALESCE(u.pic, '/pic.png') AS avatar
    FROM story_reactions sr
    LEFT JOIN users u ON u.id = sr.user_id
    WHERE sr.story_id = $1 AND sr.type = $2
    ORDER BY sr.created_at DESC
  `, [storyId, type]);

  return result.rows.map((r: any) => ({
    id: r.id,
    username: r.username,
    avatar: normalizeAvatarUrl(r.avatar),
    viewedAt: r.created_at,
  }));
}

export async function reactToStory(storyId: string, userId: string, type: string = "like", userName?: string): Promise<{ reacted: boolean; type: string } | null> {
  const existing = await db.select()
    .from(storyReactions)
    .where(and(eq(storyReactions.storyId, storyId), eq(storyReactions.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].type === type) {
      await db.delete(storyReactions)
        .where(and(eq(storyReactions.storyId, storyId), eq(storyReactions.userId, userId)));
      await db.update(stories)
        .set({ likeCount: sql`GREATEST(like_count - 1, 0)` })
        .where(eq(stories.id, storyId));
      return { reacted: false, type };
    }
    await db.update(storyReactions)
      .set({ type })
      .where(and(eq(storyReactions.storyId, storyId), eq(storyReactions.userId, userId)));
    return { reacted: true, type };
  }

  await db.insert(storyReactions).values({ storyId, userId, userName, type });
  await db.update(stories)
    .set({ likeCount: sql`like_count + 1` })
    .where(eq(stories.id, storyId));

  return { reacted: true, type };
}

export async function incrementShareCount(storyId: string): Promise<void> {
  await db.update(stories)
    .set({ shareCount: sql`share_count + 1` })
    .where(eq(stories.id, storyId));
}

export async function expireOldStories(): Promise<number> {
  const result = await db.update(stories)
    .set({ isActive: false })
    .where(and(eq(stories.isActive, true), sql`expires_at < NOW()`))
    .returning({ id: stories.id });

  return result.length;
}

export async function isStoriesEnabled(): Promise<boolean> {
  try {
    const result = await dbPool.query(
      `SELECT value FROM site_settings WHERE key = 'stories_enabled' LIMIT 1`
    );
    return result.rows[0]?.value === true || result.rows[0]?.value === "true";
  } catch {
    return true;
  }
}

function normalizeStoryRow(row: any): any {
  return {
    id: row.id,
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorRole: row.author_role,
    authorAvatar: normalizeAvatarUrl(row.author_avatar),
    authorCover: normalizeAvatarUrl(row.author_cover) || "/pich.png",
    authorNameColor: row.author_name_color || "",
    mediaUrl: row.media_url,
    mediaType: row.media_type || "text",
    caption: row.caption,
    linkUrl: row.link_url,
    bgColor: row.bg_color,
    textColor: row.text_color,
    isActive: row.is_active,
    viewCount: Number(row.view_count) || 0,
    likeCount: Number(row.like_count) || 0,
    giftCount: Number(row.gift_count) || 0,
    shareCount: Number(row.share_count) || 0,
    viewedByMe: row.viewed_by_me === true || row.viewed_by_me === "true",
    likedByMe: row.liked_by_me === true || row.liked_by_me === "true",
    followedByMe: row.followed_by_me === true || row.followed_by_me === "true",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
