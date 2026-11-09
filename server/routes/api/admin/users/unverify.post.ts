import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction, logAdminAudit } from "../../../../services/adminPermissions";
import { handleApiError } from "../../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "edituser");
    const body = await readBody(event);
    const { username } = body || {};

    if (!username) {
      setResponseStatus(event, 400);
      return { success: false, message: "اسم المستخدم مطلوب" };
    }

    // إلغاء التوثيق في جدول users
    const result = await dbPool.query(
      `UPDATE users SET documentationc = false WHERE username = $1 RETURNING idreg, topic`,
      [username]
    );

    if (result.rowCount === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "العضو غير موجود" };
    }

    const user = result.rows[0];

    // تسجيل العملية
    await logAdminAudit({
      actorId: admin.userId,
      action: "user.unverify",
      targetType: "user",
      targetId: user.topic,
      metadata: { username, idreg: user.idreg }
    });

    return { 
      success: true, 
      message: `تم إلغاء توثيق العضو ${user.topic} بنجاح` 
    };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
