import { defineEventHandler, getRouterParam } from "h3";
import { dbPool } from "../../../../db";
import { getAdminContext } from "../../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

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
