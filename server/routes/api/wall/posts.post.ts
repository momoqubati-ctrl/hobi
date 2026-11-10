import { defineEventHandler, readBody, setResponseStatus, getRequestHeader } from "h3";
import { createWallPost } from "../../../services/wallService";
import { processText } from "../../../services/filterService";
import { applyShortcuts } from "../../../services/shortcutService";
import { dbPool } from "../../../db";
import { publishGlobalEvent } from "../../../socket/SocketBroker";
import { getUserAuthContext } from "../../../services/adminAccess";
import { hasChatFeatureAccess } from "../../../services/chatAuthorization";
import { getMessagePermissionRequirements } from "../../../../src/lib/chatFeaturePermissions";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);

  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }
  const body = await readBody<Record<string, unknown> | null>(event);
  const text = body?.text;
  const mediaUrl = body?.mediaUrl;
  const animatedFaces = body?.animatedFaces;
  if (typeof text !== "string" || !text.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "البيانات ناقصة" };
  }
  if (mediaUrl !== undefined && typeof mediaUrl !== "string") {
    setResponseStatus(event, 400);
    return { success: false, message: "الوسائط غير صالحة" };
  }
  if (animatedFaces !== undefined && (!Array.isArray(animatedFaces) || animatedFaces.some((face) => typeof face !== "string"))) {
    setResponseStatus(event, 400);
    return { success: false, message: "المؤثرات غير صالحة" };
  }
  const requiredPermissions = getMessagePermissionRequirements({
    channel: "wall",
    text,
    hasMedia: Boolean(mediaUrl),
    hasEffects: Array.isArray(animatedFaces) && animatedFaces.length > 0,
  });
  if (!(await hasChatFeatureAccess({ id: auth.userId, role: auth.role }, requiredPermissions))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية استخدام إحدى ميزات منشور الحائط" };
  }

  try {
    // جلب بيانات العضو للفحص
    const userRes = auth.role === "guest"
      ? { rows: [] }
      : await dbPool.query(
          `SELECT u.username, u.display_name, u.topic, u.muted as legacy_muted, up.muted as profile_muted
           FROM users u
           LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
           WHERE CAST(u.uid AS text) = $1 OR CAST(u.id AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($1) 
           LIMIT 1`,
          [auth.userId],
        );
    const dbUser = userRes.rows[0];
    const isMuted = dbUser ? (Boolean(dbUser.profile_muted) || Boolean(dbUser.legacy_muted && dbUser.legacy_muted !== 0 && dbUser.legacy_muted !== "0")) : false;
    if (isMuted) {
      setResponseStatus(event, 403);
      return { success: false, message: "تم منعك من الحديث في الدردشة" };
    }
    // الاسم المستعار فقط — لا نستخدم اسم المستخدم الحقيقي كاسم معروض
    const fallbackAuthorName = dbUser?.topic || dbUser?.display_name || "";
    const ip = getRequestHeader(event, "x-forwarded-for") || getRequestHeader(event, "x-real-ip") || "127.0.0.1";

    // --- تطبيق الاختصارات ثم الفلترة ---
    const expanded = await applyShortcuts(text);
    const filterRes = await processText({
      text: expanded,
      source: "الحائط",
      user: { username: auth.username || auth.userId, topic: fallbackAuthorName, ip }
    });

    const post = await createWallPost(auth.userId, filterRes.filteredText, mediaUrl, fallbackAuthorName, auth.role, animatedFaces);
    publishGlobalEvent("wall_post_created", post).catch((err) => console.error("wall post broadcast failed:", err));
    return { success: true, post };
  } catch (error) {
    console.error("Wall post error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر إضافة المنشور" };
  }
});
