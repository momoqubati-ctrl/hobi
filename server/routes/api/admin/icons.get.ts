import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_icons");

  try {
    const result = await dbPool.query(
      `SELECT * FROM icons ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, icons: result.rows };
  } catch (error: any) {
    console.error("[Admin Icons] Fetch error:", error);
    return { success: false, message: "فشل جلب الايقونات" };
  }
});
