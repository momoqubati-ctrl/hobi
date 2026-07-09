import { defineEventHandler } from "h3";
import { dbPool } from "../../db";

export default defineEventHandler(async () => {
  try {
    const result = await dbPool.query(
      `SELECT id, name, image_url, sort_order FROM swiper_banners WHERE is_active = true ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, banners: result.rows };
  } catch (error: any) {
    console.error("[SwiperBanners] Fetch error:", error);
    return { success: false, message: "فشل جلب البنرات", banners: [] };
  }
});
