import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { dbPool } from "../../../../../db";
import { getAdminContext } from "../../../../../services/adminAccess";
import { handleApiError } from "../../../../../utils/apiError";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message, error: admin.message };
  }

  const roleId = getRouterParam(event, "id");
  if (!roleId) {
    setResponseStatus(event, 400);
    return { success: false, message: "معرف الرتبة مطلوب" };
  }

  try {
    const result = await dbPool.query(
      `SELECT
         u.id,
         u.username,
         u.display_name,
         u.avatar_url,
         ura.starts_at AS assigned_at,
         ura.expires_at,
         ura.assigned_by
       FROM user_role_assignments ura
       JOIN users u ON u.id = ura.user_id
       WHERE ura.role_id = $1
       ORDER BY ura.starts_at DESC`,
      [roleId]
    );

    return {
      success: true,
      members: result.rows,
      total: result.rowCount ?? 0,
    };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
