import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { createWallComment } from "../../../../services/wallService";
import { processText } from "../../../../services/filterService";
import { applyShortcuts } from "../../../../services/shortcutService";
import { createNotification } from "../../../../services/notificationService";
import { dbPool } from "../../../../db";
import { publishGlobalEvent } from "../../../../socket/SocketBroker";
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
  const text = body?.text;
  const parentId = body?.parentId;
  if (
    (typeof postId !== "string" && typeof postId !== "number") ||
    !String(postId).trim() ||
    typeof text !== "string" ||
    !text.trim()
  ) {
    setResponseStatus(event, 400);
    return { success: false, message: "البيانات ناقصة" };
  }
  if (text.length > 1000) {
    setResponseStatus(event, 413);
    return { success: false, message: "التعليق طويل جداً" };
  }
  if (!(await hasChatFeatureAccess({ id: auth.userId, role: auth.role }, ["wall_comments.use"]))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية التعليق على الحائط" };
  }

  try {
    const userRes = auth.role === "guest"
      ? { rows: [] }
      : await dbPool.query(
          `SELECT u.username, u.topic, u.pic, u.muted as legacy_muted, up.muted as profile_muted 
           FROM users u
           LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
           WHERE CAST(u.uid AS text) = $1 OR CAST(u.id AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($1) 
           LIMIT 1`,
          [auth.userId],
        );
    const user = userRes.rows[0];
    const isMuted = user ? (Boolean(user.profile_muted) || Boolean(user.legacy_muted && user.legacy_muted !== 0 && user.legacy_muted !== "0")) : false;
    if (isMuted) {
      setResponseStatus(event, 403);
      return { success: false, message: "تم منعك من الحديث في الدردشة" };
    }
    const fallbackName = auth.username;

    const expanded = await applyShortcuts(text);
    const filterRes = await processText({
      text: expanded,
      source: "تعليق على الحائط",
      user: { username: user?.username || fallbackName, topic: user?.topic || fallbackName, ip: "127.0.0.1" },
    });

    if (filterRes.action === "block") {
      setResponseStatus(event, 403);
      return { success: false, message: "التعليق مخالف للقوانين" };
    }

    const comment = await createWallComment(String(postId), auth.userId, fallbackName, filterRes.filteredText, parentId);

    // Notification: if reply → notify comment author, else notify post author
    try {
      if (parentId) {
        const parentRes = await dbPool.query(
          `SELECT author_id FROM bar_comments WHERE id = $1 LIMIT 1`,
          [parseInt(parentId, 10)],
        );
        if (parentRes.rows.length > 0) {
          const parentAuthorId = parentRes.rows[0].author_id;
          if (parentAuthorId && String(parentAuthorId) !== String(auth.userId)) {
            await createNotification(parentAuthorId, auth.userId, "reply", "wall_comment", comment.id, {
              postId,
              commentBody: text.slice(0, 100),
            }).catch(() => {});
          }
        }
      } else {
        const postRes = await dbPool.query(
          `SELECT uid FROM bars WHERE id = $1 LIMIT 1`,
          [parseInt(postId, 10)],
        );
        if (postRes.rows.length > 0) {
          const postAuthorId = postRes.rows[0].uid;
          if (postAuthorId && String(postAuthorId) !== String(auth.userId)) {
            await createNotification(postAuthorId, auth.userId, "comment", "wall_post", postId, {
              commentBody: text.slice(0, 100),
            }).catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error("Wall comment notification error:", error);
    }

    publishGlobalEvent("wall_comment_created", comment).catch(() => {});
    return { success: true, comment };
  } catch (error) {
    console.error("Wall comment error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر إضافة التعليق" };
  }
});
