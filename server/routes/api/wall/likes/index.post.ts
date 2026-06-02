import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { toggleWallLike } from "../../../../services/wallService";
import { createNotification } from "../../../../services/notificationService";
import { dbPool } from "../../../../db";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { postId, userId } = body;

  if (!postId || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "postId و userId مطلوبان" };
  }

  try {
    const result = await toggleWallLike(postId, userId);

    if (result.liked) {
      const postRes = await dbPool.query(
        `SELECT uid, topic FROM bars WHERE id = $1 LIMIT 1`,
        [parseInt(postId, 10)],
      );
      if (postRes.rows.length > 0) {
        const postAuthor = postRes.rows[0];
        const postAuthorId = String(postAuthor.uid || "");
        if (postAuthorId && String(postAuthorId) !== String(userId)) {
          await createNotification(postAuthorId, userId, "like", "wall_post", postId, {
            postBody: (postAuthor.topic || "").slice(0, 100),
          }).catch(() => {});
        }
      }
    }

    return { success: true, liked: result.liked };
  } catch (error) {
    console.error("Toggle like error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تعديل الإعجاب" };
  }
});
