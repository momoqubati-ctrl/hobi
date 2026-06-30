import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  try {
    const result = await dbPool.query(
      `SELECT * FROM room_badges ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, badges: result.rows };
  } catch (error: any) {
    console.error("[Admin Room Badges] Fetch error:", error);
    return { success: false, message: "فشل جلب الشارات" };
  }
});
