import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const body = await readBody(event);

    const { name, nameColor, badgeText, badgeBg, iconUrl, permissions, rank, isSystem } = body || {};

    if (!name?.trim()) {
      setResponseStatus(event, 400);
      return { success: false, message: "اسم الرتبة مطلوب" };
    }

    const check = await dbPool.query("SELECT id FROM custom_roles WHERE name = $1", [name.trim()]);
    if (check.rowCount && check.rowCount > 0) {
      setResponseStatus(event, 400);
      return { success: false, message: "يوجد رتبة بهذا الاسم مسبقاً" };
    }

    const result = await dbPool.query(
      `INSERT INTO custom_roles 
        (name, name_color, badge_text, badge_bg, icon_url, permissions, rank, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name.trim(),
        nameColor || null,
        badgeText || null,
        badgeBg || null,
        iconUrl || null,
        JSON.stringify(permissions || []),
        rank || 0,
        isSystem || false
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
    return handleApiError(event, error);
  }
});
