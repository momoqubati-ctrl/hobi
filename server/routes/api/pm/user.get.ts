import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const result = await dbPool.query(
      `SELECT u.id, u.uid, u.username, u.topic, u.pic,
              COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as name_color,
              COALESCE(NULLIF(up.message_color, ''), NULLIF(u.mcol, '')) as message_color
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id::text = $1 OR u.uid::text = $1 OR u.idreg::text = $1 OR lower(u.username) = lower($1) 
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { success: false, message: "المستخدم غير موجود" };
    }

    const user = result.rows[0];
    // نُرجع uid (معرّف العضو النصي) لأنه يطابق localStorage.user.id ويستخدم في كل أنحاء التطبيق
    return {
      success: true,
      user: {
        id: user.id || user.uid,
        name: user.topic || user.username,
        avatar: user.pic || "/pic.png",
        nameColor: user.name_color || "",
        messageColor: user.message_color || "",
      },
    };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message || "خطأ في الخادم" };
  }
});
