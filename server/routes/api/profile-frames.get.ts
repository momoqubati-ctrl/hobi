import { defineEventHandler } from "h3";
import { dbPool } from "../../db";

export default defineEventHandler(async (event) => {
  try {
    const result = await dbPool.query(
      `SELECT id, name, image_url FROM profile_frames ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, frames: result.rows };
  } catch (error: any) {
    console.error("[Profile Frames] Fetch error:", error);
    return { success: false, message: "فشل جلب الاطارات", frames: [] };
  }
});
