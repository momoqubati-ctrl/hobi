import type { PoolClient } from "pg";
import {
  ANNOUNCEMENT_DAILY_LIMIT_MAX,
  isValidAnnouncementDailyLimit,
} from "../../src/lib/chatFeaturePermissions";
import { logAdminAudit } from "./adminPermissions";
import { isSiteOwnerRoleName } from "./siteOwner";

export type AnnouncementDailyLimitsResult =
  | { success: true; values: Record<string, number> }
  | { success: false; message: string };

export class AnnouncementRolePolicyError extends Error {
  constructor(
    message: string,
    readonly code: "ROLE_NOT_FOUND" | "ROLE_OWNER_PROTECTED" | "ROLE_SITE_OWNER_PROTECTED",
  ) {
    super(message);
    this.name = "AnnouncementRolePolicyError";
  }
}

export function parseAnnouncementDailyLimits(
  input: unknown,
  matrixRoleIds: readonly string[],
): AnnouncementDailyLimitsResult {
  if (input === undefined) return { success: true, values: {} };
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { success: false, message: "قيم الحد اليومي غير صالحة" };
  }

  const allowedRoleIds = new Set(matrixRoleIds);
  const values: Record<string, number> = {};

  for (const [roleId, limit] of Object.entries(input)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roleId)) {
      return { success: false, message: "معرف رتبة غير صالح في الحصة اليومية" };
    }
    if (!allowedRoleIds.has(roleId)) {
      return { success: false, message: "لا يمكن تحديث حصة رتبة خارج مصفوفة الصلاحيات" };
    }
    if (!isValidAnnouncementDailyLimit(limit)) {
      return { success: false, message: "يجب أن يكون الحد اليومي عددًا صحيحًا بين 0 و1000" };
    }
    values[roleId] = limit;
  }

  return { success: true, values };
}

export async function persistAnnouncementRolePolicy(
  client: PoolClient,
  matrix: Record<string, Record<string, unknown>>,
  dailyLimits: Record<string, number>,
  actorId: string,
): Promise<{ affectedUsers: string[] }> {
  await client.query("BEGIN");

  try {
    const roleIds = Object.keys(matrix);
    const roleRows = roleIds.length
      ? await client.query(
        `SELECT id, is_owner, name FROM roles WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [roleIds],
      )
      : { rows: [] };

    if (roleRows.rows.length !== roleIds.length) {
      throw new AnnouncementRolePolicyError("إحدى الرتب المحددة غير موجودة", "ROLE_NOT_FOUND");
    }
    if (roleRows.rows.some((role) => role.is_owner)) {
      throw new AnnouncementRolePolicyError("صلاحيات رتبة المالك ثابتة ولا يمكن تعديلها", "ROLE_OWNER_PROTECTED");
    }
    if (roleRows.rows.some((role) => isSiteOwnerRoleName(role.name))) {
      throw new AnnouncementRolePolicyError("صلاحيات مجموعة مالك الموقع ثابتة ولا يمكن تعديلها", "ROLE_SITE_OWNER_PROTECTED");
    }

    for (const [roleId, permissions] of Object.entries(matrix)) {
      await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);

      for (const [key, value] of Object.entries(permissions)) {
        if (value === true || value === 1) {
          await client.query(
            "INSERT INTO role_permissions (role_id, permission_key, permission_value) VALUES ($1, $2, $3::jsonb)",
            [roleId, key, JSON.stringify(true)],
          );
        }
      }
    }

    for (const [roleId, dailyLimit] of Object.entries(dailyLimits)) {
      await client.query(
        `UPDATE roles SET announcement_daily_limit = $2, updated_at = now() WHERE id = $1`,
        [roleId, dailyLimit],
      );
    }

    const users = roleIds.length
      ? await client.query(
        "SELECT DISTINCT user_id FROM user_role_assignments WHERE role_id = ANY($1::uuid[])",
        [roleIds],
      )
      : { rows: [] };

    await logAdminAudit({
      actorId,
      action: "permissions.bulk_update",
      targetType: "system",
      targetId: "matrix",
      metadata: {
        rolesCount: roleIds.length,
        announcementDailyLimitsCount: Object.keys(dailyLimits).length,
      },
    }, { queryExecutor: client, throwOnError: true });

    await client.query("COMMIT");

    return { affectedUsers: users.rows.map((row) => String(row.user_id)) };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[Permissions] Failed to roll back role policy update:", rollbackError);
    }
    throw error;
  }
}
