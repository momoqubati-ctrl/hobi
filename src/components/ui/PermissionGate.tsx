import type { ReactNode } from "react";
import { useRealtimeStore } from "@/lib/realtime-store";
import { hasAllPermissionAccess } from "@/lib/permissionAccess";

interface PermissionGateProps {
  requiredPermissions: readonly string[];
  children: ReactNode;
}

export function PermissionGate({ requiredPermissions, children }: PermissionGateProps) {
  const permissions = useRealtimeStore((state) => state.userPermissions);
  if (!hasAllPermissionAccess(permissions, requiredPermissions)) return null;
  return children;
}
