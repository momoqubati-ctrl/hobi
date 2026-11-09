import { SITE_OWNER_ROLE_NAME, isSiteOwnerRoleName } from "./siteOwner";

export const SYSTEM_OWNER_USERNAME = "safarihost";
export const SYSTEM_OWNER_ROLE_NAME = "__system_owner__";
export const SYSTEM_OWNER_RANK = 100000;

const RESERVED_OWNER_ROLE_NAMES = new Set([
  SYSTEM_OWNER_ROLE_NAME,
  SITE_OWNER_ROLE_NAME,
  "owner",
  "ispower",
  "مالك",
]);

export function isSystemOwnerUsername(username: unknown): boolean {
  return String(username || "").trim().toLowerCase() === SYSTEM_OWNER_USERNAME;
}

export function canAssignSystemOwnerRole(username: unknown): boolean {
  return isSystemOwnerUsername(username);
}

export function isReservedOwnerRoleName(name: unknown): boolean {
  const normalizedName = String(name || "").trim().toLowerCase();
  return RESERVED_OWNER_ROLE_NAMES.has(normalizedName) || isSiteOwnerRoleName(normalizedName);
}
