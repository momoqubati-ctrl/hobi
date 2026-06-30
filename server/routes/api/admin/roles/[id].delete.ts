import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction, logAdminAudit } from "../../../../services/adminPermissions";
import { invalidatePermissionCache } from "../../../../services/permissionEngine";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const roleId = getRouterParam(event, "id");

    if (!roleId) {
      setResponseStatus(event, 400);
      return { success: false, message: "معرف الرتبة مطلوب" };
    }

    // حذف صلاحيات الرتبة أولاً
    await dbPool.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);

    // مسح كاش المستخدمين
    const usersRes = await dbPool.query(
      "SELECT user_id FROM user_role_assignments WHERE role_id = $1", [roleId]
    );
    for (const row of usersRes.rows) {
      await invalidatePermissionCache(row.user_id);
    }

    // حذف التعيينات
    await dbPool.query("DELETE FROM user_role_assignments WHERE role_id = $1", [roleId]);

    // حذف الرتبة
    const result = await dbPool.query("DELETE FROM roles WHERE id = $1 RETURNING id, legacy_name AS name", [roleId]);

    if (result.rowCount === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "الرتبة غير موجودة" };
    }

    await logAdminAudit({
      actorId: admin.userId,
      action: "role.delete",
      targetType: "role",
      targetId: roleId,
      metadata: { name: result.rows[0].name },
    });

    return { success: true, message: "تم حذف الرتبة بنجاح" };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});
