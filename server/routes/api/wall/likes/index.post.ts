import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { toggleWallLike } from "../../../../services/wallService";
import { createNotification } from "../../../../services/notificationService";
import { dbPool } from "../../../../db";
import { getUserAuthContext } from "../../../../services/adminAccess";
import { hasChatFeatureAccess } from "../../../../services/chatAuthorization";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);

  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }
  const body = await readBody<Record<string, unknown> | null>(event);
  const postId = body?.postId;
  if ((typeof postId !== "number" && typeof postId !== "string") || !String(postId).trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "postId مطلوب" };
  }
  const parsedPostId = Number(postId);
  if (!Number.isSafeInteger(parsedPostId) || parsedPostId <= 0) {
    setResponseStatus(event, 400);
    return { success: false, message: "postId غير صالح" };
  }
  if (!(await hasChatFeatureAccess({ id: auth.userId, role: auth.role }, ["wall_reactions.use"]))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية التفاعل مع الحائط" };
  }

  try {
    const result = await toggleWallLike(parsedPostId, auth.userId);

    if (result.liked) {
      const postRes = await dbPool.query(
        `SELECT uid, topic FROM bars WHERE id = $1 LIMIT 1`,
        [parsedPostId],
      );
      if (postRes.rows.length > 0) {
        const postAuthor = postRes.rows[0];
        const postAuthorId = String(postAuthor.uid || "");
        if (postAuthorId && String(postAuthorId) !== String(auth.userId)) {
          await createNotification(postAuthorId, auth.userId, "like", "wall_post", String(parsedPostId), {
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
