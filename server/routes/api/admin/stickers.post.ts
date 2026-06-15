import { defineEventHandler, readBody } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const body = await readBody<{ category_id: string; name?: string; image_url: string; sort_order?: number }>(event);
  if (!body?.category_id) return { success: false, message: "معرف القسم مطلوب" };
  if (!body?.image_url?.trim()) return { success: false, message: "رابط الصورة مطلوب" };

  try {
    const result = await dbPool.query(
      `INSERT INTO stickers (category_id, name, image_url, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.category_id, body.name || "", body.image_url.trim(), body.sort_order || 0]
    );
    return { success: true, sticker: result.rows[0] };
  } catch (error: any) {
    console.error("[Admin Stickers] Create error:", error);
    return { success: false, message: "فشل إنشاء الملصق" };
  }
});
