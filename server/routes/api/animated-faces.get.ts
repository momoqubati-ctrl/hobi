import { defineEventHandler } from "h3";
import { dbPool } from "../../db";

export default defineEventHandler(async () => {
  try {
    const result = await dbPool.query(
      `SELECT id, shortcut, name, image_url FROM animated_faces WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, faces: result.rows };
  } catch (error: any) {
    console.error("[Animated Faces] Fetch error:", error);
    return { success: true, faces: [] };
  }
});
