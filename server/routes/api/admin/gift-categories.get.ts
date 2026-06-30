import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  try {
    const { rows: tables } = await dbPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'gift_catalog' AND column_name = 'category_id'`
    );
    const hasCategoryId = tables.length > 0;

    let query: string;
    if (hasCategoryId) {
      query = `SELECT gc.*, COALESCE(gcnt.cnt, 0)::int as gift_count
               FROM gift_categories gc
               LEFT JOIN (SELECT category_id, COUNT(*) as cnt FROM gift_catalog GROUP BY category_id) gcnt ON gcnt.category_id = gc.id
               ORDER BY gc.sort_order ASC, gc.created_at ASC`;
    } else {
      query = `SELECT gc.*, 0 as gift_count FROM gift_categories gc ORDER BY gc.sort_order ASC, gc.created_at ASC`;
    }

    const result = await dbPool.query(query);
    return { success: true, categories: result.rows };
  } catch (error: any) {
    console.error("[Admin Gift Categories] Fetch error:", error);
    return { success: false, message: "فشل جلب الأقسام" };
  }
});
