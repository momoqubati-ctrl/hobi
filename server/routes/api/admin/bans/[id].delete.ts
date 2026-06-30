import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction, logAdminAudit } from "../../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "ban");
    const id = getRouterParam(event, "id");

    if (!id) {
      setResponseStatus(event, 400);
      return { success: false, message: "معرف الحظر مطلوب" };
    }

    const check = await dbPool.query(
      "SELECT id, target_name, ban_type FROM moderation_bans WHERE id = $1",
      [id],
    );

    if (check.rowCount === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "سجل الحظر غير موجود" };
    }

    const ban = check.rows[0];

    await dbPool.query(
      "UPDATE moderation_bans SET is_active = false WHERE id = $1",
      [id],
    );

    await logAdminAudit({
      actorId: admin.userId,
      action: "ban.delete",
      targetType: "ban",
      targetId: String(id),
      metadata: {
        targetName: ban.target_name,
        banType: ban.ban_type,
      },
    });

    return { success: true, message: "تم فك الحظر بنجاح" };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});
