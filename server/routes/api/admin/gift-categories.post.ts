import { defineEventHandler, readBody } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const body = await readBody<{ name: string; sort_order?: number }>(event);
  if (!body?.name?.trim()) return { success: false, message: "اسم القسم مطلوب" };

  try {
    const result = await dbPool.query(
      `INSERT INTO gift_categories (name, sort_order) VALUES ($1, $2) RETURNING *`,
      [body.name.trim(), body.sort_order || 0]
    );
    return { success: true, category: result.rows[0] };
  } catch (error: any) {
    console.error("[Admin Gift Categories] Create error:", error);
    return { success: false, message: "فشل إنشاء القسم" };
  }
});
