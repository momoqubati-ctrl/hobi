import { getQuery, setResponseHeader, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";
import {
  isEphemeralPrivateMessagingEnabled,
  registerPrivateMessageSession,
  resolveUserIdentity,
} from "../../../services/privateMessageService";

export default createAuthenticatedUserHandler(async (event, auth) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  if (!isEphemeralPrivateMessagingEnabled()) {
    setResponseStatus(event, 503);
    return { success: false, message: "الرسائل الخاصة المؤقتة غير مهيأة على هذا الخادم" };
  }
  if (!auth.sessionId || !registerPrivateMessageSession({
    sessionId: auth.sessionId,
    userId: auth.userId,
    expiresAt: auth.expiresAt,
  })) {
    setResponseStatus(event, 401);
    return { success: false, message: "جلسة غير صالحة" };
  }
  const query = getQuery(event);
  const userId = typeof query.userId === "string" ? query.userId : "";

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const identity = await resolveUserIdentity(userId);
    if (!identity) {
      setResponseStatus(event, 404);
      return { success: false, message: "المستخدم غير موجود" };
    }

    const result = await dbPool.query(
      `SELECT u.id, u.username, u.display_name, u.topic, u.mention_name, u.public_user_id, u.pic,
              COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as name_color,
              COALESCE(NULLIF(up.message_color, ''), NULLIF(u.mcol, '')) as message_color
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id::text = $1`,
      [identity.id]
    );

    if (result.rows.length === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "المستخدم غير موجود" };
    }

    const user = result.rows[0];
    return {
      success: true,
      user: {
        id: user.id,
        name: user.display_name || user.topic || user.username,
        mentionName: user.mention_name || "",
        publicUserId: user.public_user_id || "",
        avatar: user.pic || "/pic.png",
        nameColor: user.name_color || "",
        messageColor: user.message_color || "",
      },
    };
  } catch (error) {
    console.error("PM user lookup failed:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "خطأ في الخادم" };
  }
});
