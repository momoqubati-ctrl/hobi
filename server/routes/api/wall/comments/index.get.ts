import { defineEventHandler, getQuery } from "h3";
import { listPostComments } from "../../../../services/wallService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const postId = query.postId as string;

  if (!postId) {
    return { success: false, message: "postId مطلوب" };
  }

  try {
    const comments = await listPostComments(postId);
    return { success: true, comments };
  } catch (error) {
    console.error("Failed to fetch comments:", error);
    return { success: false, message: "تعذر جلب التعليقات" };
  }
});
