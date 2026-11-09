export const DEFAULT_MEMBER_ROLE_NAME = "__system_default_member__";
export const DEFAULT_MEMBER_ROLE_LABEL = "العضو الافتراضي";
export const DEFAULT_MEMBER_ROLE_PERMISSIONS = [
  "frame.use",
  "custombg.use",
  "chattem.use",
] as const;

export function shouldAssignDefaultMemberRole(role: string): boolean {
  return String(role || "").trim().toLowerCase() === "member";
}
