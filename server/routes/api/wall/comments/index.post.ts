import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { createWallComment } from "../../../../services/wallService";
import { processText } from "../../../../services/filterService";
import { applyShortcuts } from "../../../../services/shortcutService";
import { createNotification } from "../../../../services/notificationService";
import { dbPool } from "../../../../db";
import { publishGlobalEvent } from "../../../../socket/SocketBroker";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { postId, authorId, authorName, authorRole, text, parentId } = body;

  if (!postId || !authorId || !text) {
    setResponseStatus(event, 400);
    return { success: false, message: "البيانات ناقصة" };
  }

  try {
    const isGuest = authorRole === "guest" || String(authorId).startsWith("guest-");
    const userRes = isGuest
      ? { rows: [] as any[] }
      : await dbPool.query(
          `SELECT u.username, u.topic, u.pic, u.muted as legacy_muted, up.muted as profile_muted 
           FROM users u
           LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
           WHERE CAST(u.uid AS text) = $1 OR CAST(u.id AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($1) 
           LIMIT 1`,
          [authorId],
        );
    const user = userRes.rows[0];
    const isMuted = user ? (Boolean(user.profile_muted) || Boolean(user.legacy_muted && user.legacy_muted !== 0 && user.legacy_muted !== "0")) : false;
    if (isMuted) {
      setResponseStatus(event, 403);
      return { success: false, message: "تم منعك من الحديث في الدردشة" };
    }
    const fallbackName = authorName || authorId;

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

    const comment = await createWallComment(postId, authorId, fallbackName, filterRes.filteredText, parentId);

    // Notification: if reply → notify comment author, else notify post author
    try {
      if (parentId) {
        const parentRes = await dbPool.query(
          `SELECT author_id FROM bar_comments WHERE id = $1 LIMIT 1`,
          [parseInt(parentId, 10)],
        );
        if (parentRes.rows.length > 0) {
          const parentAuthorId = parentRes.rows[0].author_id;
          if (parentAuthorId && String(parentAuthorId) !== String(authorId)) {
            await createNotification(parentAuthorId, authorId, "reply", "wall_comment", comment.id, {
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
          if (postAuthorId && String(postAuthorId) !== String(authorId)) {
            await createNotification(postAuthorId, authorId, "comment", "wall_post", postId, {
              commentBody: text.slice(0, 100),
            }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    publishGlobalEvent("wall_comment_created", comment).catch(() => {});
    return { success: true, comment };
  } catch (error) {
    console.error("Wall comment error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر إضافة التعليق" };
  }
});
