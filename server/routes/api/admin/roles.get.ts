import { defineEventHandler, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getUserAuthContext } from "../../../services/adminAccess";
import { hasPermission } from "../../../services/permissionEngine";
import { getUserAuthoritativeRank } from "../../../services/powersService";
import { isSystemOwnerUsername } from "../../../services/systemOwner";
import { SITE_OWNER_DISPLAY_NAME, SITE_OWNER_ROLE_NAME } from "../../../services/siteOwner";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }

  // جلب رتبة الفاعل الموثقة من قاعدة البيانات أولاً
  const actor = await getUserAuthoritativeRank(auth.userId, auth.username);
  const roleLower = String(auth.role || "").toLowerCase().trim();
  const isOwner = isSystemOwnerUsername(auth.username);

  const actorRank = isOwner ? 100000 : (actor?.rank || 9000);

  // فحص الصلاحية: هل المستخدم يملك صلاحية إدارة أو عرض الرتب؟
  let canAccess =
    isOwner ||
    ["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"].includes(roleLower) ||
    (actor && actor.rank >= 6000);

  if (!canAccess) {
    canAccess =
      (await hasPermission(auth.userId, "setpower.read" as any)) ||
      (await hasPermission(auth.userId, "setpower.edit" as any)) ||
      (await hasPermission(auth.userId, "setpower.all" as any)) ||
      (await hasPermission(auth.userId, "admin_roles.read" as any)) ||
      (await hasPermission(auth.userId, "admin_roles.all" as any));
  }

  if (!canAccess) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية عرض أو تعديل الرتب" };
  }

  const rolesResult = await dbPool.query(
    `SELECT
       r.id,
       CASE WHEN r.is_default THEN r.legacy_name ELSE r.name END AS name,
       r.legacy_name,
       r.rank,
       r.icon_url AS ico,
       r.is_default,
       r.is_owner,
       (r.name = $1) AS is_site_owner,
       r.is_active,
       r.auto_enabled,
       r.auto_promote,
       r.auto_points,
       r.announcement_daily_limit,
       r.legacy_metadata->>'color' AS color,
       r.legacy_metadata AS raw,
       r.created_at,
       r.updated_at,
       COUNT(DISTINCT ura.user_id)::int AS member_count,
       COALESCE(jsonb_object_agg(rp.permission_key, rp.permission_value) FILTER (WHERE rp.permission_key IS NOT NULL), '{}'::jsonb) AS permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN user_role_assignments ura ON ura.role_id = r.id
     GROUP BY r.id
     ORDER BY r.rank DESC, r.legacy_name ASC`,
    [SITE_OWNER_ROLE_NAME],
  );

  for (const role of rolesResult.rows) {
    if (role.is_owner) role.name = "Owner";
    if (role.is_site_owner) role.name = SITE_OWNER_DISPLAY_NAME;
  }

  return {
    success: true,
    isOwner,
    actorRank,
    roles: rolesResult.rows,
  };
});
