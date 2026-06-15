import { defineEventHandler, readBody } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const body = await readBody<{ shortcut: string; name?: string; image_url: string; sort_order?: number }>(event);
  if (!body?.shortcut?.trim()) return { success: false, message: "الاختصار مطلوب" };
  if (!body?.image_url?.trim()) return { success: false, message: "رابط الصورة مطلوب" };

  try {
    const result = await dbPool.query(
      `INSERT INTO animated_faces (shortcut, name, image_url, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.shortcut.trim(), body.name || "", body.image_url.trim(), body.sort_order || 0]
    );
    return { success: true, face: result.rows[0] };
  } catch (error: any) {
    if (error.code === "23505") {
      return { success: false, message: "هذا الاختصار موجود مسبقاً" };
    }
    console.error("[Admin Animated Faces] Create error:", error);
    return { success: false, message: "فشل إنشاء الفيس" };
  }
});
