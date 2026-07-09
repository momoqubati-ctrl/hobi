import { defineEventHandler, readBody, setResponseStatus, getRequestHeader } from "h3";
import { createWallPost } from "../../../services/wallService";
import { processText } from "../../../services/filterService";
import { applyShortcuts } from "../../../services/shortcutService";
import { dbPool } from "../../../db";
import { publishGlobalEvent } from "../../../socket/SocketBroker";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { authorId, authorName, authorRole, text, mediaUrl, animatedFaces } = body;

  if (!authorId || !text) {
    setResponseStatus(event, 400);
    return { success: false, message: "البيانات ناقصة" };
  }

  try {
    // جلب بيانات العضو للفحص
    const isGuestAuthor = authorRole === "guest" || String(authorId).startsWith("guest-");
    const userRes = isGuestAuthor
      ? { rows: [] as any[] }
      : await dbPool.query(
          `SELECT u.username, u.topic, u.muted as legacy_muted, up.muted as profile_muted 
           FROM users u
           LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
           WHERE CAST(u.uid AS text) = $1 OR CAST(u.id AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($1) 
           LIMIT 1`,
          [authorId],
        );
    const dbUser = userRes.rows[0];
    const isMuted = dbUser ? (Boolean(dbUser.profile_muted) || Boolean(dbUser.legacy_muted && dbUser.legacy_muted !== 0 && dbUser.legacy_muted !== "0")) : false;
    if (isMuted) {
      setResponseStatus(event, 403);
      return { success: false, message: "تم منعك من الحديث في الدردشة" };
    }
    const fallbackAuthorName = typeof authorName === "string" && authorName.trim() ? authorName.trim().slice(0, 80) : authorId;
    const user = dbUser || { username: authorId, topic: fallbackAuthorName };
    const ip = getRequestHeader(event, "x-forwarded-for") || getRequestHeader(event, "x-real-ip") || "127.0.0.1";

    // --- تطبيق الاختصارات ثم الفلترة ---
    const expanded = await applyShortcuts(text);
    const filterRes = await processText({
      text: expanded,
      source: "الحائط",
      user: { username: user.username, topic: user.topic, ip }
    });

    const post = await createWallPost(authorId, filterRes.filteredText, mediaUrl, fallbackAuthorName, authorRole, animatedFaces);
    publishGlobalEvent("wall_post_created", post).catch((err) => console.error("wall post broadcast failed:", err));
    return { success: true, post };
  } catch (error) {
    console.error("Wall post error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر إضافة المنشور" };
  }
});
