import { defineEventHandler, getRouterParam } from "h3";
import { dbPool } from "../../../../db";
import { getAdminContext } from "../../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const id = getRouterParam(event, "id");
  if (!id) return { success: false, message: "معرف الفيس مطلوب" };

  try {
    await dbPool.query(`DELETE FROM animated_faces WHERE id = $1`, [id]);
    return { success: true, message: "تم حذف الفيس" };
  } catch (error: any) {
    console.error("[Admin Animated Faces] Delete error:", error);
    return { success: false, message: "فشل حذف الفيس" };
  }
});
