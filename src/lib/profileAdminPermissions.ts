import { hasPermissionAccess } from "./permissionAccess";

export const PROFILE_ADMIN_ACTION_PERMISSION = {
  nick: "edituser",
  message: "edituser",
  likes: "ulike",
  site_badge: "edituser",
  power: "setpower",
  room_move: "loveu",
  pull_to_room: "rooms",
  history: "history",
  kick: "kick",
  room_kick: "kick",
  room_mute: "meiut",
  room_unmute: "meiut",
  delete_pic: "delpic",
  ban: "ban",
  global_mute: "meiut",
  global_unmute: "meiut",
  alert: "alert",
} as const;

export type ProfileAdminAction = keyof typeof PROFILE_ADMIN_ACTION_PERMISSION;

export function canRunProfileAdminAction(
  permissions: readonly string[],
  action: string,
): boolean {
  if (!Object.hasOwn(PROFILE_ADMIN_ACTION_PERMISSION, action)) return false;

  const resource = PROFILE_ADMIN_ACTION_PERMISSION[action as ProfileAdminAction];
  const permissionAction = action === "history" ? "read" : "edit";
  return hasPermissionAccess(permissions, `${resource}.${permissionAction}`);
}
