import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  try {
    const result = await dbPool.query(
      `SELECT * FROM animated_faces ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, faces: result.rows };
  } catch (error: any) {
    console.error("[Admin Animated Faces] Fetch error:", error);
    return { success: false, message: "فشل جلب الفيسات" };
  }
});
