import { dbPool } from "../db";
import {
  getAnnouncementOnlineUsers,
} from "../socket/presenceManager";
import { normalizeRoomIdValue } from "../socket/roomAccess";
import type { AnnouncementType } from "./announcementDeliveryPolicy";

export interface AnnouncementAudienceUser {
  id: string;
  role: string;
  roomId?: string;
}

export interface RankedAnnouncementRoleAssignment {
  userId: string;
  isActive: boolean;
  isDefault: boolean;
  startsAt: Date | string;
  expiresAt: Date | string | null;
}

export interface AnnouncementAudienceDependencies {
  getOnlineUsers(): Promise<AnnouncementAudienceUser[]>;
  getRoomMembers(roomId: string): Promise<AnnouncementAudienceUser[]>;
  resolveRoomId(roomId: string): Promise<string | null>;
  getRankedAssignments(
    onlineUserIds: readonly string[],
    now: Date,
  ): Promise<RankedAnnouncementRoleAssignment[]>;
}

export class AnnouncementAudienceError extends Error {
  constructor(
    message: string,
    readonly code: "ROOM_NOT_FOUND",
  ) {
    super(message);
    this.name = "AnnouncementAudienceError";
  }
}

function getRoomIdCandidates(input: string): string[] {
  const raw = input.trim();
  return [...new Set([
    raw,
    normalizeRoomIdValue(raw),
    raw.split(":").pop()?.trim() ?? "",
  ].filter(Boolean))];
}

async function findCanonicalRoomId(input: string): Promise<string | null> {
  const candidates = getRoomIdCandidates(input);
  if (candidates.length === 0) return null;

  const result = await dbPool.query<{ id: string }>(
    `SELECT CAST(id AS text) AS id
     FROM rooms
     WHERE CAST(id AS text) = ANY($1::text[])
        OR slug = ANY($1::text[])
     LIMIT 1`,
    [candidates],
  );
  return result.rows[0]?.id ?? null;
}

async function findRankedAssignments(
  onlineUserIds: readonly string[],
  now: Date,
): Promise<RankedAnnouncementRoleAssignment[]> {
  if (onlineUserIds.length === 0) return [];

  const result = await dbPool.query<{
    user_id: string;
    is_active: boolean;
    is_default: boolean;
    starts_at: Date | string;
    expires_at: Date | string | null;
  }>(
    `SELECT DISTINCT
       assignment.user_id,
       r.is_active,
       r.is_default,
       assignment.starts_at,
       assignment.expires_at
     FROM user_role_assignments assignment
     JOIN roles r ON r.id = assignment.role_id
     WHERE assignment.user_id = ANY($1::text[])
       AND assignment.starts_at <= $2
       AND (assignment.expires_at IS NULL OR assignment.expires_at > $2)
       AND r.is_active = true
       AND r.is_default = false`,
    [onlineUserIds, now],
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    isActive: row.is_active,
    isDefault: row.is_default,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
  }));
}

const defaultDependencies: AnnouncementAudienceDependencies = {
  getOnlineUsers: getAnnouncementOnlineUsers,
  getRoomMembers: async (roomId) =>
    (await getAnnouncementOnlineUsers())
      .filter((user) => String(user.roomId ?? "").trim() === roomId),
  resolveRoomId: findCanonicalRoomId,
  getRankedAssignments: findRankedAssignments,
};

function getConnectedMemberIds(users: readonly AnnouncementAudienceUser[]): string[] {
  const ids = new Set<string>();
  for (const user of users) {
    const userId = String(user.id ?? "").trim();
    if (!userId || userId === "0" || user.role.trim().toLowerCase() === "guest") continue;
    ids.add(userId);
  }
  return [...ids];
}

function isActiveRankedAssignment(
  assignment: RankedAnnouncementRoleAssignment,
  now: Date,
): boolean {
  const startsAt = new Date(assignment.startsAt).getTime();
  const expiresAt = assignment.expiresAt === null
    ? null
    : new Date(assignment.expiresAt).getTime();

  return assignment.isActive &&
    !assignment.isDefault &&
    Number.isFinite(startsAt) &&
    startsAt <= now.getTime() &&
    (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > now.getTime()));
}

export async function resolveAnnouncementAudience(
  input: {
    type: AnnouncementType;
    roomId?: string;
  },
  dependencies: AnnouncementAudienceDependencies = defaultDependencies,
  now: Date = new Date(),
): Promise<{ recipientIds: string[]; roomId?: string }> {
  let roomId: string | undefined;
  let connectedUsers: AnnouncementAudienceUser[];

  if (input.type === "room") {
    const requestedRoomId = String(input.roomId ?? "").trim();
    const resolvedRoomId = requestedRoomId
      ? await dependencies.resolveRoomId(requestedRoomId)
      : null;
    if (!resolvedRoomId) {
      throw new AnnouncementAudienceError("الغرفة غير موجودة", "ROOM_NOT_FOUND");
    }

    roomId = resolvedRoomId;
    connectedUsers = (await dependencies.getRoomMembers(roomId))
      .filter((user) => String(user.roomId ?? "").trim() === roomId);
  } else {
    connectedUsers = await dependencies.getOnlineUsers();
  }

  const onlineMemberIds = getConnectedMemberIds(connectedUsers);
  if (input.type !== "ranked") {
    return { recipientIds: onlineMemberIds, ...(roomId ? { roomId } : {}) };
  }

  const assignments = await dependencies.getRankedAssignments(onlineMemberIds, now);
  const rankedIds = new Set(
    assignments
      .filter((assignment) => isActiveRankedAssignment(assignment, now))
      .map((assignment) => assignment.userId),
  );

  return {
    recipientIds: onlineMemberIds.filter((userId) => rankedIds.has(userId)),
  };
}
