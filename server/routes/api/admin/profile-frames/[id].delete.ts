import { defineEventHandler, getRouterParam } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction } from "../../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_profileframes");

  const id = getRouterParam(event, "id");
  if (!id) return { success: false, message: "معرف الإطار مطلوب" };

  try {
    await dbPool.query(`DELETE FROM profile_frames WHERE id = $1`, [id]);
    return { success: true, message: "تم حذف الإطار" };
  } catch (error: any) {
    console.error("[Admin Profile Frames] Delete error:", error);
    return { success: false, message: "فشل حذف الإطار" };
  }
});
