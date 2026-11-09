import type { BasicResource, PermissionKey } from "./permissionEngine";

export type AdminPermission = PermissionKey | BasicResource | "owner";

export function resolvePermissionKeys(permission: AdminPermission, method: string): PermissionKey[] {
  if (permission === "owner") return [];
  if (permission.includes(".")) return [permission as PermissionKey];

  const normalizedMethod = method.toUpperCase();
  const action = normalizedMethod === "GET" || normalizedMethod === "HEAD"
    ? "read"
    : normalizedMethod === "DELETE"
      ? "delete"
      : "edit";

  return [`${permission}.${action}` as PermissionKey, `${permission}.all` as PermissionKey];
}
