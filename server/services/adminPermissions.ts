import { getAdminContext } from "./adminAccess";
import { H3Event, setResponseStatus } from "h3";
import { hasPermission as engineHasPermission } from "./permissionEngine";
import type { PermissionKey } from "./permissionEngine";
import { resolvePermissionKeys } from "./permissionActionResolver";
import type { AdminPermission } from "./permissionActionResolver";
import type { PoolClient } from "pg";
import { isSystemOwnerUsername } from "./systemOwner";
import { ApiError } from "../utils/apiError";

export type { AdminPermission } from "./permissionActionResolver";

/**
 * يتحقق مما إذا كان المشرف يملك صلاحية معينة
 */
export const hasPermission = async (userId: string, permission: PermissionKey): Promise<boolean> => {
  return engineHasPermission(userId, permission);
};

/**
 * Middleware للتحقق من الصلاحية داخل الـ API
 */
export const guardAdminAction = async (event: H3Event, permission: AdminPermission) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    throw new ApiError(admin.statusCode, admin.statusCode === 401 ? "UNAUTHORIZED" : "FORBIDDEN", admin.message);
  }

  // المالك يملك كل الصلاحيات
  if (isSystemOwnerUsername(admin.username)) return admin;

  const allowedPermissions = resolvePermissionKeys(permission, event.method);
  let allowed = false;
  for (const allowedPermission of allowedPermissions) {
    if (await hasPermission(admin.userId, allowedPermission)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    setResponseStatus(event, 403);
    throw new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية الكافية لتنفيذ هذا الإجراء");
  }

  return admin;
};

/**
 * تسجيل عملية إدارية في السجل
 */
export const logAdminAudit = async (params: {
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}, options: { queryExecutor?: Pick<PoolClient, "query">; throwOnError?: boolean } = {}) => {
  try {
    const queryExecutor = options.queryExecutor ?? (await import("../db")).dbPool;
    await queryExecutor.query(
      `INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, metadata)
       VALUES ((SELECT id FROM users WHERE CAST(idreg AS text) = $1 OR CAST(id AS text) = $2 OR CAST(uid AS text) = $2 LIMIT 1), $3, $4, $5, $6::jsonb)`,
      [
        String(params.actorId),
        String(params.actorId),
        params.action,
        params.targetType || null,
        params.targetId || null,
        JSON.stringify(params.metadata || {}),
      ],
    );
  } catch (err) {
    console.error("Audit log error:", err);
    if (options.throwOnError) throw err;
  }
};
