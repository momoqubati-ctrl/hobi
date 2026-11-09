export function hasPermissionAccess(
  permissions: readonly string[],
  requiredPermission: string,
): boolean {
  const separator = requiredPermission.lastIndexOf(".");
  if (separator <= 0 || separator === requiredPermission.length - 1) return false;
  if (permissions.includes(requiredPermission)) return true;

  const action = requiredPermission.slice(separator + 1);
  if (action === "all") return false;

  return permissions.includes(`${requiredPermission.slice(0, separator)}.all`);
}

export function hasAllPermissionAccess(
  permissions: readonly string[],
  requiredPermissions: readonly string[],
): boolean {
  return requiredPermissions.length > 0 &&
    requiredPermissions.every((permission) => hasPermissionAccess(permissions, permission));
}
