import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";
import { invalidatePermissionCache } from "../../../services/permissionEngine";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const body = await readBody(event);

    if (!body || !body.id) {
      setResponseStatus(event, 400);
      return { success: false, message: "معرف الرتبة مطلوب" };
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.name !== undefined) { 
      fields.push(`legacy_name = $${idx++}`); 
      values.push(body.name.trim()); 
      fields.push(`name = $${idx++}`); 
      values.push(body.name.trim()); 
    }
    if (body.rank !== undefined) { fields.push(`rank = $${idx++}`); values.push(parseInt(body.rank, 10) || 0); }
    if (body.icon !== undefined) { fields.push(`icon_url = $${idx++}`); values.push(body.icon || null); }
    if (body.is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(!!body.is_active); }
    if (body.auto_enabled !== undefined) { fields.push(`auto_enabled = $${idx++}, auto_promote = $${idx}`); values.push(body.auto_enabled ? 1 : 0, body.auto_enabled ? 1 : 0); }
    if (body.auto_points !== undefined) { fields.push(`auto_points = $${idx++}`); values.push(Math.max(0, parseInt(body.auto_points, 10) || 0)); }
    if (body.color !== undefined) { fields.push(`legacy_metadata = $${idx++}`); values.push(JSON.stringify({ color: body.color })); }

    if (fields.length === 0) {
      setResponseStatus(event, 400);
      return { success: false, message: "لا توجد بيانات للتحديث" };
    }

    values.push(body.id);
    const query = `UPDATE roles SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, legacy_name AS name, rank, icon_url AS ico, auto_enabled, auto_points, legacy_metadata->>'color' AS color`;
    const result = await dbPool.query(query, values);

    if (result.rowCount === 0) {
      setResponseStatus(event, 404);
      return { success: false, message: "الرتبة غير موجودة" };
    }

    // مسح كاش المستخدمين المرتبطين بهذه الرتبة
    const usersRes = await dbPool.query(
      "SELECT user_id FROM user_role_assignments WHERE role_id = $1", [body.id]
    );
    for (const row of usersRes.rows) {
      await invalidatePermissionCache(row.user_id);
    }

    await logAdminAudit({
      actorId: admin.userId,
      action: "role.update",
      targetType: "role",
      targetId: body.id,
      metadata: { updatedFields: fields.map(f => f.split("=")[0].trim()) },
    });

    return { success: true, role: result.rows[0], message: "تم تحديث الرتبة بنجاح" };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});
