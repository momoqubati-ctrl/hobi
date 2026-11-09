import { dbPool } from "../db";
import { ANNOUNCEMENT_DAILY_LIMIT_MAX } from "../../src/lib/chatFeaturePermissions";
import { isSystemOwnerUsername } from "./systemOwner";

export type AnnouncementType = "all" | "ranked" | "room";

export interface AnnouncementRoleAssignment {
  isActive: boolean;
  isDefault: boolean;
  isOwner: boolean;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  dailyLimit: number;
  permissionKeys: readonly string[];
}

export interface AnnouncementSenderPolicy {
  allowedTypes: AnnouncementType[];
  dailyLimit: number;
}

const ANNOUNCEMENT_PERMISSION_TYPES: ReadonlyArray<
  readonly [string, AnnouncementType]
> = [
  ["announcement_all.use", "all"],
  ["announcement_ranked.use", "ranked"],
  ["announcement_room.use", "room"],
];

function isValidDailyLimit(limit: number): boolean {
  return Number.isInteger(limit) &&
    limit >= 0 &&
    limit <= ANNOUNCEMENT_DAILY_LIMIT_MAX;
}

export function resolveAnnouncementSenderPolicy(
  username: string,
  assignments: readonly AnnouncementRoleAssignment[],
  now: Date = new Date(),
): AnnouncementSenderPolicy {
  const allowedTypes = new Set<AnnouncementType>();
  let dailyLimit = 0;
  let hasActiveOwnerRole = false;
  const nowMs = now.getTime();

  for (const assignment of assignments) {
    const startsAt = new Date(assignment.startsAt).getTime();
    const expiresAt = assignment.expiresAt === null
      ? null
      : new Date(assignment.expiresAt).getTime();

    if (
      !assignment.isActive ||
      !Number.isFinite(startsAt) ||
      startsAt > nowMs ||
      (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= nowMs))
    ) {
      continue;
    }

    if (assignment.isOwner) hasActiveOwnerRole = true;

    const grantedTypes = ANNOUNCEMENT_PERMISSION_TYPES.filter(([key]) =>
      assignment.permissionKeys.includes(key),
    );
    if (grantedTypes.length === 0) continue;

    if (!isValidDailyLimit(assignment.dailyLimit)) {
      throw new Error("Invalid announcement daily limit in active role");
    }

    for (const [, type] of grantedTypes) allowedTypes.add(type);
    dailyLimit = Math.max(dailyLimit, assignment.dailyLimit);
  }

  if (isSystemOwnerUsername(username) && hasActiveOwnerRole) {
    return { allowedTypes: ["all", "ranked", "room"], dailyLimit: 10000 };
  }

  return { allowedTypes: [...allowedTypes], dailyLimit };
}

interface AssignmentRow {
  role_id: string;
  username: string;
  is_active: boolean;
  is_default: boolean;
  is_owner: boolean;
  starts_at: Date | string;
  expires_at: Date | string | null;
  announcement_daily_limit: number;
  permission_key: string | null;
}

export async function getAnnouncementSenderPolicy(
  userId: string,
  username: string,
  now: Date = new Date(),
): Promise<AnnouncementSenderPolicy> {
  const result = await dbPool.query<AssignmentRow>(
    `SELECT
      r.id AS role_id,
      u.username,
      r.is_active,
       r.is_default,
       r.is_owner,
       r.announcement_daily_limit,
       assignment.starts_at,
       assignment.expires_at,
       rp.permission_key
     FROM user_role_assignments assignment
     JOIN roles r ON r.id = assignment.role_id
     JOIN users u ON u.id = assignment.user_id
     LEFT JOIN role_permissions rp
       ON rp.role_id = r.id
      AND rp.permission_value = 'true'::jsonb
     WHERE assignment.user_id = $1
       AND assignment.starts_at <= $2
       AND (assignment.expires_at IS NULL OR assignment.expires_at > $2)
       AND r.is_active = true`,
    [userId, now],
  );

  const assignmentsByRole = new Map<string, AnnouncementRoleAssignment>();
  for (const row of result.rows) {
    const assignment = assignmentsByRole.get(row.role_id) ?? {
      isActive: row.is_active,
      isDefault: row.is_default,
      isOwner: row.is_owner,
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      dailyLimit: row.announcement_daily_limit,
      permissionKeys: [] as string[],
    };

    if (row.permission_key) {
      assignment.permissionKeys.push(row.permission_key);
    }
    assignmentsByRole.set(row.role_id, assignment);
  }

  return resolveAnnouncementSenderPolicy(
    result.rows[0]?.username ?? username,
    [...assignmentsByRole.values()],
    now,
  );
}
