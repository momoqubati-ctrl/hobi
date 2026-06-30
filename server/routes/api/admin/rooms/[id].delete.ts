import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { getAdminContext } from "../../../../services/adminAccess";
import { invalidateRoomCache } from "../../../../services/chatStore";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message };
  }

  const id = getRouterParam(event, "id");
  if (!id) {
    return { success: false, message: "معرف الغرفة مطلوب" };
  }

  try {
    const room = await dbPool.query(
      "SELECT idroom, id, topic FROM rooms WHERE idroom = $1 AND COALESCE(deleted, 0) = 0 LIMIT 1",
      [id],
    );

    if ((room.rowCount || 0) === 0) {
      return { success: false, message: "الغرفة غير موجودة" };
    }

    await dbPool.query("UPDATE rooms SET deleted = 1 WHERE idroom = $1", [id]);

    invalidateRoomCache();

    return { success: true, message: `تم حذف الغرفة "${room.rows[0].topic}" بنجاح` };
  } catch (err: any) {
    console.error("Delete room error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء حذف الغرفة" };
  }
});
