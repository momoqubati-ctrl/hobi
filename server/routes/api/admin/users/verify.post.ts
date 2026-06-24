import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction, logAdminAudit } from "../../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "edituser");
    const body = await readBody(event);
    const { username } = body;

    if (!username) {
      setResponseStatus(event, 400);
      return { success: false, message: "اسم المستخدم مطلوب" };
    }

    // تحديث حالة التوثيق في جدول users القديم
    const result = await dbPool.query(
      `UPDATE users SET documentationc = true WHERE username = $1 RETURNING idreg, topic`,
      [username]
    );

    if (result.rowCount === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "العضو غير موجود" };
    }

    const user = result.rows[0];

    // تسجيل العملية في سجل الإدارة
    await logAdminAudit({
      actorId: admin.userId,
      action: "user.verify",
      targetType: "user",
      targetId: user.topic,
      metadata: { username, idreg: user.idreg }
    });

    return { 
      success: true, 
      message: `تم توثيق العضو ${user.topic} بنجاح` 
    };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message || "حدث خطأ أثناء التوثيق" };
  }
});