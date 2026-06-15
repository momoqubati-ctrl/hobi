import { defineEventHandler } from "h3";
import { dbPool } from "../../db";

export default defineEventHandler(async () => {
  try {
    const categoriesResult = await dbPool.query(
      `SELECT id, name, icon, sort_order FROM sticker_categories WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
    );

    const stickersResult = await dbPool.query(
      `SELECT id, category_id, name, image_url, sort_order FROM stickers WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
    );

    const categories = categoriesResult.rows;
    const stickers = stickersResult.rows;

    return {
      success: true,
      categories: categories.map((cat) => ({
        ...cat,
        stickers: stickers.filter((s) => s.category_id === cat.id),
      })),
    };
  } catch (error: any) {
    console.error("[Stickers] Fetch error:", error);
    return { success: true, categories: [] };
  }
});
