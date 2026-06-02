import { defineEventHandler, getQuery } from "h3";
import { listWallPosts, getCommentCounts, getLikeCounts, getUserLikedPosts } from "../../../services/wallService";

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const currentUserId = (query.userId as string) || null;

    const posts = await listWallPosts();
    const postIds = posts.map((p: any) => parseInt(p.id, 10)).filter((id: number) => !isNaN(id));

    const [commentCounts, likeCounts] = await Promise.all([
      postIds.length > 0 ? getCommentCounts(postIds) : Promise.resolve({}),
      postIds.length > 0 ? getLikeCounts(postIds) : Promise.resolve({}),
    ]);

    let userLikedSet = new Set<string>();
    if (currentUserId && postIds.length > 0) {
      userLikedSet = await getUserLikedPosts(currentUserId, postIds);
    }

    const enriched = posts.map((post: any) => ({
      ...post,
      commentCount: commentCounts[post.id] || 0,
      likeCount: likeCounts[post.id] || 0,
      userLiked: userLikedSet.has(post.id),
    }));

    return { success: true, posts: enriched };
  } catch (error) {
    console.error("listWallPosts error:", error);
    return { success: false, message: "تعذر جلب المنشورات" };
  }
});
