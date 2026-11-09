import {
  DEFAULT_CHAT_FEATURE_PERMISSION_KEYS,
  hasAllRequiredPermissions,
} from "../../src/lib/chatFeaturePermissions";
import { getUserContext } from "./permissionEngine";

const guestPermissions = new Set<string>(DEFAULT_CHAT_FEATURE_PERMISSION_KEYS);
const privilegedRoles = new Set(["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"]);

export async function hasChatFeatureAccess(
  user: { id?: string; userId?: string; role?: string; username?: string },
  requiredPermissions: readonly string[],
): Promise<boolean> {
  const role = String(user?.role || "").trim().toLowerCase();
  if (role === "guest") {
    return requiredPermissions.every((permission) => guestPermissions.has(permission));
  }
  if (privilegedRoles.has(role)) {
    return true;
  }
  const effectiveId = user?.id || user?.userId;
  if (!effectiveId) return false;

  const context = await getUserContext(effectiveId);
  if (context.isStaff || context.rankPriority >= 9000) {
    return true;
  }
  if (context.permissions.size === 0) {
    return requiredPermissions.every((permission) => guestPermissions.has(permission));
  }
  return hasAllRequiredPermissions(context.permissions, requiredPermissions);
}
