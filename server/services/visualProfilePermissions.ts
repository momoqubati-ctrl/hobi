type VisualProfileField = "avatarFrameUrl" | "memberCardBgUrl";
type PermissionCollection = ReadonlySet<string> | readonly string[];

const getRequiredPermission = (field: VisualProfileField, value: unknown): string | null => {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (field === "avatarFrameUrl") return "frame.use";
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? "custombg.use" : "chattem.use";
};

const hasPermission = (permissions: PermissionCollection, permission: string): boolean =>
  Array.isArray(permissions)
    ? permissions.includes(permission)
    : permissions.has(permission);

export function filterProfileUpdatesByPermissions<T extends Record<string, unknown>>(
  updates: T,
  permissions: PermissionCollection,
): Partial<T> {
  const allowedUpdates: Partial<T> = { ...updates };

  (["avatarFrameUrl", "memberCardBgUrl"] as const).forEach((field) => {
    const requiredPermission = getRequiredPermission(field, updates[field]);
    if (requiredPermission && !hasPermission(permissions, requiredPermission)) {
      delete allowedUpdates[field];
    }
  });

  return allowedUpdates;
}
