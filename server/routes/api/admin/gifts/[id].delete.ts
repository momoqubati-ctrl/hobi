import { defineEventHandler, getRouterParam } from "h3";
import { dbPool } from "../../../../db";
import { getAdminContext } from "../../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) return { success: false, message: admin.message };

  const id = getRouterParam(event, "id");
  if (!id) return { success: false, message: "معرف الهدية مطلوب" };

  try {
    await dbPool.query(`DELETE FROM gift_catalog WHERE id = $1`, [id]);
    return { success: true, message: "تم حذف الهدية" };
  } catch (error: any) {
    console.error("[Admin Gifts] Delete error:", error);
    return { success: false, message: "فشل حذف الهدية" };
  }
});
