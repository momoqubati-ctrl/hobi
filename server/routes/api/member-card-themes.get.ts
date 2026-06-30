import { defineEventHandler } from "h3";
import { dbPool } from "../../db";

export default defineEventHandler(async (event) => {
  try {
    const result = await dbPool.query(
      `SELECT id, name, image_url FROM member_card_themes ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, themes: result.rows };
  } catch (error: any) {
    console.error("[Member Card Themes] Fetch error:", error);
    return { success: false, message: "فشل جلب الثيمات", themes: [] };
  }
});
