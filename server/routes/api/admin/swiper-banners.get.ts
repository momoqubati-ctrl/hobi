import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_swiperbanners");

  try {
    const result = await dbPool.query(
      `SELECT * FROM swiper_banners ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, banners: result.rows };
  } catch (error: any) {
    console.error("[Admin Swiper Banners] Fetch error:", error);
    return { success: false, message: "فشل جلب البنرات" };
  }
});
