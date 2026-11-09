import { defineEventHandler, getRouterParam } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction } from "../../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_swiperbanners");

  const id = getRouterParam(event, "id");
  if (!id) return { success: false, message: "معرف البنر مطلوب" };

  try {
    await dbPool.query(`DELETE FROM swiper_banners WHERE id = $1`, [id]);
    return { success: true, message: "تم حذف البنر" };
  } catch (error: any) {
    console.error("[Admin Swiper Banners] Delete error:", error);
    return { success: false, message: "فشل حذف البنر" };
  }
});
