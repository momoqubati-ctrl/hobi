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
          "SELECT username, topic FROM users WHERE CAST(uid AS text) = $1 OR CAST(id AS text) = $1 OR CAST(idreg AS text) = $1 OR lower(username) = lower($1) LIMIT 1",
          [authorId],
        );
    const fallbackAuthorName = typeof authorName === "string" && authorName.trim() ? authorName.trim().slice(0, 80) : authorId;
    const user = userRes.rows[0] || { username: authorId, topic: fallbackAuthorName };
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
