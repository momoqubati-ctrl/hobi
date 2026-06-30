import { defineEventHandler, readBody } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const body = await readBody<{
    name?: string;
    power?: number;
    icon?: string;
    bg?: string;
    bg_type?: string;
    sort_order?: number;
  }>(event);

  try {
    const result = await dbPool.query(
      `INSERT INTO room_badges (name, power, icon, bg, bg_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        body.name || "",
        body.power || 0,
        body.icon || "",
        body.bg || "",
        body.bg_type || "static",
        body.sort_order || 0,
      ]
    );
    return { success: true, badge: result.rows[0] };
  } catch (error: any) {
    console.error("[Admin Room Badges] Create error:", error);
    return { success: false, message: "فشل إنشاء الشارة" };
  }
});
