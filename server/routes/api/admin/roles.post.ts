import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";
import { invalidatePermissionCache } from "../../../services/permissionEngine";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const body = await readBody(event);

    if (!body || !body.name || !body.rank) {
      setResponseStatus(event, 400);
      return { success: false, message: "الاسم والرقم مطلوبان" };
    }

    const { name, rank, icon, auto_enabled, auto_points, color } = body;

    const result = await dbPool.query(
      `INSERT INTO roles (legacy_name, name, rank, icon_url, auto_enabled, auto_promote, auto_points, legacy_metadata)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
       RETURNING id, legacy_name AS name, rank, icon_url AS ico, auto_enabled, auto_points, legacy_metadata->>'color' AS color`,
      [
        name.trim(),
        name.trim(),
        parseInt(rank, 10) || 0,
        icon || null,
        auto_enabled ? 1 : 0,
        Math.max(0, parseInt(auto_points, 10) || 0),
        color ? JSON.stringify({ color }) : null,
      ]
    );

    await logAdminAudit({
      actorId: admin.userId,
      action: "role.create",
      targetType: "role",
      targetId: result.rows[0].id,
      metadata: { name, rank },
    });

    return { success: true, role: result.rows[0], message: "تم إنشاء الرتبة بنجاح" };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});
