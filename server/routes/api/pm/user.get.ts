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
      `SELECT id, uid, username, topic, pic FROM users 
       WHERE id::text = $1 OR uid::text = $1 OR idreg::text = $1 OR lower(username) = lower($1) LIMIT 1`,
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
        id: user.uid || user.id,
        name: user.topic || user.username,
        avatar: user.pic || "/pic.png",
      },
    };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message || "خطأ في الخادم" };
  }
});
