import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  try {
    const result = await dbPool.query(
      `SELECT sc.*, COUNT(s.id)::int as sticker_count
       FROM sticker_categories sc
       LEFT JOIN stickers s ON s.category_id = sc.id
       GROUP BY sc.id
       ORDER BY sc.sort_order ASC, sc.created_at ASC`
    );
    return { success: true, categories: result.rows };
  } catch (error: any) {
    console.error("[Admin Sticker Categories] Fetch error:", error);
    return { success: false, message: "فشل جلب الأقسام" };
  }
});
