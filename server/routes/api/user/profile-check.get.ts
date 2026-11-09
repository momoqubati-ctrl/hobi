import { defineEventHandler, setResponseStatus } from "h3";
import { getUserAuthContext } from "../../../services/adminAccess";
import { dbPool } from "../../../db";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId) {
    setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
    return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
  }

  const userId = auth.userId;

  try {
    const result = await dbPool.query(
      `SELECT "user_id", "avatar_frame_url", "member_card_bg_url" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
      [userId]
    );
    return {
      success: true,
      userId,
      profileRow: result.rows[0] || null,
    };
  } catch (e: any) {
    console.error("[Profile-Check] Error:", e);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر التحقق من الملف الشخصي" };
  }
});
