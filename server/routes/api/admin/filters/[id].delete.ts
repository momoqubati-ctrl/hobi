import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction, logAdminAudit } from "../../../../services/adminPermissions";
import { handleApiError } from "../../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "flter");
    const id = getRouterParam(event, "id");

    if (!id) {
      setResponseStatus(event, 400);
      return { success: false, message: "معرف الفلتر مطلوب" };
    }

    // جلب الكلمة قبل الحذف للسجل
    const check = await dbPool.query("SELECT v FROM notext WHERE id = $1", [id]);
    if (check.rowCount === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "الكلمة غير موجودة" };
    }

    const pattern = check.rows[0].v;

    await dbPool.query("DELETE FROM notext WHERE id = $1", [id]);

    await logAdminAudit({
      actorId: admin.userId,
      action: "filter.delete",
      targetType: "filter",
      targetId: pattern,
      metadata: { id }
    });

    return { success: true, message: "تم حذف الكلمة من الفلتر بنجاح" };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
