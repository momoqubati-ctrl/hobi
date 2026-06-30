import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction, logAdminAudit } from "../../../../services/adminPermissions";
import { invalidatePermissionCache } from "../../../../services/permissionEngine";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const body = await readBody(event);
    const { matrix } = body;

    if (!matrix || typeof matrix !== 'object') {
      throw new Error("بيانات المصفوفة غير صالحة");
    }

    await dbPool.query("BEGIN");

    for (const [roleId, perms] of Object.entries(matrix)) {
      // مسح الصلاحيات القديمة للرتبة
      await dbPool.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
      
      // إضافة الصلاحيات الجديدة
      for (const [key, value] of Object.entries(perms as any)) {
        if (value === true || value === 1) {
          await dbPool.query(
            "INSERT INTO role_permissions (role_id, permission_key, permission_value) VALUES ($1, $2, $3::jsonb)",
            [roleId, key, JSON.stringify(true)]
          );
        }
      }
    }

    await logAdminAudit({
      actorId: admin.userId,
      action: "permissions.bulk_update",
      targetType: "system",
      targetId: "matrix",
      metadata: { rolesCount: Object.keys(matrix).length }
    });

    await dbPool.query("COMMIT");
    
    // تفريغ كاش كل المستخدمين المتأثرين
    const roleIds = Object.keys(matrix);
    const usersRes = await dbPool.query(
      "SELECT DISTINCT user_id FROM user_role_assignments WHERE role_id = ANY($1::uuid[])",
      [roleIds]
    );
    for (const row of usersRes.rows) {
      await invalidatePermissionCache(row.user_id);
    }

    return { success: true, message: "تم تحديث مصفوفة الصلاحيات بنجاح" };
  } catch (error: any) {
    await dbPool.query("ROLLBACK");
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});