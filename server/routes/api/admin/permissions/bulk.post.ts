import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { guardAdminAction } from "../../../../services/adminPermissions";
import { invalidatePermissionCache } from "../../../../services/permissionEngine";
import {
  AnnouncementRolePolicyError,
  parseAnnouncementDailyLimits,
  persistAnnouncementRolePolicy,
} from "../../../../services/announcementRolePolicy";
import { ApiError, handleApiError } from "../../../../utils/apiError";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPermissionValue(value: unknown): boolean {
  return value === true || value === false || value === 1 || value === 0;
}

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "admin_roles.all");
    const body = await readBody(event);
    if (!isRecord(body) || !isRecord(body.matrix)) {
      setResponseStatus(event, 422);
      return { success: false, message: "بيانات المصفوفة غير صالحة" };
    }

    const matrix = body.matrix;
    const roleIds = Object.keys(matrix);
    const permissionMatrix: Record<string, Record<string, unknown>> = {};
    for (const [roleId, permissions] of Object.entries(matrix)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roleId)) {
        setResponseStatus(event, 422);
        return { success: false, message: "معرف رتبة غير صالح" };
      }
      if (
        !isRecord(permissions) ||
        Object.entries(permissions).some(([key, value]) => !key.trim() || !isPermissionValue(value))
      ) {
        setResponseStatus(event, 422);
        return { success: false, message: "بيانات صلاحيات الرتبة غير صالحة" };
      }
      permissionMatrix[roleId] = permissions;
    }

    const dailyLimits = parseAnnouncementDailyLimits(body.announcementDailyLimits, roleIds);
    if (dailyLimits.success === false) {
      setResponseStatus(event, 422);
      return { success: false, message: dailyLimits.message };
    }

    const client = await dbPool.connect();
    try {
      const { affectedUsers } = await persistAnnouncementRolePolicy(
        client,
        permissionMatrix,
        dailyLimits.values,
        admin.userId,
      );
      for (const userId of affectedUsers) {
        await invalidatePermissionCache(userId);
      }
    } finally {
      client.release();
    }

    return { success: true, message: "تم تحديث مصفوفة الصلاحيات بنجاح" };
  } catch (error) {
    if (error instanceof ApiError) {
      return handleApiError(event, error);
    }
    if (error instanceof AnnouncementRolePolicyError) {
      const status = error.code === "ROLE_NOT_FOUND" ? 404 : 403;
      setResponseStatus(event, status);
      return { success: false, message: error.message };
    }
    console.error("[Permissions] Failed to update role policies:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تحديث الصلاحيات" };
  }
});
