import { defineEventHandler, getQuery } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const query = getQuery(event);
  const categoryId = query.category_id as string | undefined;

  try {
    let result;
    if (categoryId) {
      result = await dbPool.query(
        `SELECT s.*, sc.name as category_name FROM stickers s
         JOIN sticker_categories sc ON sc.id = s.category_id
         WHERE s.category_id = $1
         ORDER BY s.sort_order ASC, s.created_at ASC`,
        [categoryId]
      );
    } else {
      result = await dbPool.query(
        `SELECT s.*, sc.name as category_name FROM stickers s
         JOIN sticker_categories sc ON sc.id = s.category_id
         ORDER BY s.sort_order ASC, s.created_at ASC`
      );
    }
    return { success: true, stickers: result.rows };
  } catch (error: any) {
    console.error("[Admin Stickers] Fetch error:", error);
    return { success: false, message: "فشل جلب الملصقات" };
  }
});
