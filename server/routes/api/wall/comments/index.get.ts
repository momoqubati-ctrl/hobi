import { defineEventHandler, getQuery } from "h3";
import { listPostComments, getCommentLikeCounts, getUserLikedComments } from "../../../../services/wallService";

function flattenCommentIds(comments: any[]): number[] {
  const ids: number[] = [];
  const walk = (list: any[]) => {
    for (const c of list) {
      const n = parseInt(c.id, 10);
      if (!isNaN(n)) ids.push(n);
      if (c.replies?.length) walk(c.replies);
    }
  };
  walk(comments);
  return ids;
}

function enrichCommentsWithLikes(comments: any[], likeCounts: Record<string, number>, userLikedSet: Set<string>): any[] {
  return comments.map(c => ({
    ...c,
    likeCount: likeCounts[String(c.id)] || 0,
    userLiked: userLikedSet.has(String(c.id)),
    replies: c.replies?.length ? enrichCommentsWithLikes(c.replies, likeCounts, userLikedSet) : [],
  }));
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const postId = query.postId as string;
  const currentUserId = (query.userId as string) || null;

  if (!postId) {
    return { success: false, message: "postId مطلوب" };
  }

  try {
    const comments = await listPostComments(postId);
    const commentIds = flattenCommentIds(comments);

    let likeCounts: Record<string, number> = {};
    let userLikedSet = new Set<string>();

    if (commentIds.length > 0) {
      [likeCounts, userLikedSet] = await Promise.all([
        getCommentLikeCounts(commentIds),
        currentUserId ? getUserLikedComments(currentUserId, commentIds) : Promise.resolve(new Set<string>()),
      ]);
    }

    const enriched = enrichCommentsWithLikes(comments, likeCounts, userLikedSet);

    return { success: true, comments: enriched };
  } catch (error) {
    console.error("Failed to fetch comments:", error);
    return { success: false, message: "تعذر جلب التعليقات" };
  }
});
