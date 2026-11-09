import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";
import { invalidatePermissionCache } from "../../../services/permissionEngine";
import { SYSTEM_OWNER_RANK, isReservedOwnerRoleName } from "../../../services/systemOwner";
import { isSiteOwnerRoleName } from "../../../services/siteOwner";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const body = await readBody(event);

    if (!body || !body.id) {
      setResponseStatus(event, 400);
      return { success: false, message: "معرف الرتبة مطلوب" };
    }

    const roleResult = await dbPool.query(
      `SELECT is_default, is_owner, rank, name FROM roles WHERE id = $1 LIMIT 1`,
      [body.id],
    );
    if (!roleResult.rows[0]) {
      setResponseStatus(event, 404);
      return { success: false, message: "الرتبة غير موجودة" };
    }

    if (roleResult.rows[0].is_owner) {
      setResponseStatus(event, 403);
      return { success: false, message: "رتبة المالك محمية ولا يمكن تعديلها" };
    }
    if (isSiteOwnerRoleName(roleResult.rows[0].name)) {
      setResponseStatus(event, 403);
      return { success: false, message: "مجموعة مالك الموقع محمية ولا يمكن تعديلها" };
    }

    if (body.name !== undefined && isReservedOwnerRoleName(body.name)) {
      setResponseStatus(event, 400);
      return { success: false, message: "اسم رتبة المالك محجوز للنظام" };
    }
    if (body.rank !== undefined && Number.parseInt(String(body.rank), 10) >= SYSTEM_OWNER_RANK) {
      setResponseStatus(event, 400);
      return { success: false, message: `يجب أن يكون ترتيب الرتبة أقل من ${SYSTEM_OWNER_RANK}` };
    }

    if (roleResult.rows[0].is_default) {
      const currentRank = Number(roleResult.rows[0].rank);
      const requestedRank = body.rank === undefined ? currentRank : parseInt(body.rank, 10);
      if (
        (body.is_active !== undefined && !Boolean(body.is_active)) ||
        requestedRank !== currentRank ||
        (body.auto_enabled !== undefined && Boolean(body.auto_enabled)) ||
        (body.auto_points !== undefined && Number(body.auto_points) > 0)
      ) {
        setResponseStatus(event, 400);
        return { success: false, message: "لا يمكن تعطيل الرتبة الافتراضية أو تغيير ترتيبها أو تفعيل ترقيتها الآلية" };
      }
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
    const query = `UPDATE roles SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, legacy_name AS name, rank, icon_url AS ico, is_default, auto_enabled, auto_points, legacy_metadata->>'color' AS color`;
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
    return handleApiError(event, error);
  }
});
