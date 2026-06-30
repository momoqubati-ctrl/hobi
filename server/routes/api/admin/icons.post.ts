import { defineEventHandler, readBody } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const body = await readBody<{ name?: string; image_url: string; sort_order?: number }>(event);
  if (!body?.image_url?.trim()) return { success: false, message: "رابط الصورة مطلوب" };

  try {
    const result = await dbPool.query(
      `INSERT INTO icons (name, image_url, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [body.name || "", body.image_url.trim(), body.sort_order || 0]
    );
    return { success: true, icon: result.rows[0] };
  } catch (error: any) {
    console.error("[Admin Icons] Create error:", error);
    return { success: false, message: "فشل إنشاء الايقونة" };
  }
});
