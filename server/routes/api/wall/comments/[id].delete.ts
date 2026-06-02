import { defineEventHandler, getRouterParam, setResponseStatus, getRequestHeader } from "h3";
import { deleteWallComment } from "../../../../services/wallService";
import { dbPool } from "../../../../db";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { success: false, message: "معرف التعليق مطلوب" };
  }

  const authHeader = getRequestHeader(event, "authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    setResponseStatus(event, 401);
    return { success: false, message: "غير مصرح" };
  }

  try {
    const userRes = await dbPool.query(
      "SELECT user_id FROM tokens WHERE token = $1 AND expires_at > now() LIMIT 1",
      [token],
    );
    if (userRes.rows.length === 0) {
      setResponseStatus(event, 401);
      return { success: false, message: "الجلسة منتهية" };
    }
    const authorId = userRes.rows[0].user_id;

    const deleted = await deleteWallComment(id, authorId);
    if (!deleted) {
      setResponseStatus(event, 404);
      return { success: false, message: "التعليق غير موجود أو غير مصرح بالحذف" };
    }

    return { success: true, message: "تم حذف التعليق" };
  } catch (error) {
    console.error("Delete comment error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر حذف التعليق" };
  }
});
