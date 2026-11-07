import { z } from "zod";
import { dbPool } from "../db";
import type { Pool } from "pg";

export const DEFAULT_ROOM_CUSTOM_ROLE_PERMISSIONS = {
  canKick: false,
  canMute: false,
  canManageMics: false,
  canPin: false,
  canClearMessages: false,
  canBan: false,
} as const;

export const roomCustomRolePermissionsSchema = z.object({
  canKick: z.boolean().default(false),
  canMute: z.boolean().default(false),
  canManageMics: z.boolean().default(false),
  canPin: z.boolean().default(false),
  canClearMessages: z.boolean().default(false),
  canBan: z.boolean().default(false),
}).strict();

const roomCustomRolePermissionPatchSchema = z.object({
  canKick: z.boolean().optional(),
  canMute: z.boolean().optional(),
  canManageMics: z.boolean().optional(),
  canPin: z.boolean().optional(),
  canClearMessages: z.boolean().optional(),
  canBan: z.boolean().optional(),
}).strict().refine((permissions) => Object.keys(permissions).length > 0);

const roomCustomRoleNameSchema = z.string().trim().min(1).max(64);
const roomCustomRoleColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const createRoomCustomRoleSchema = z.object({
  name: roomCustomRoleNameSchema,
  color: roomCustomRoleColorSchema.default("#64748b"),
  powerLevel: z.number().int().min(1).max(99_999).default(1000),
  permissions: roomCustomRolePermissionsSchema.default(DEFAULT_ROOM_CUSTOM_ROLE_PERMISSIONS),
}).strict();

export const updateRoomCustomRoleSchema = z.object({
  name: roomCustomRoleNameSchema.optional(),
  color: roomCustomRoleColorSchema.optional(),
  powerLevel: z.number().int().min(1).max(99_999).optional(),
  permissions: roomCustomRolePermissionPatchSchema.optional(),
}).strict().refine((input) => Object.keys(input).length > 0);

export type RoomCustomRolePermissions = z.infer<typeof roomCustomRolePermissionsSchema>;
export type CreateRoomCustomRoleInput = z.infer<typeof createRoomCustomRoleSchema>;
export type UpdateRoomCustomRoleInput = z.infer<typeof updateRoomCustomRoleSchema>;
export type RoomCustomRoleDatabase = Pick<Pool, "query">;

export interface RoomCustomRole {
  id: string;
  name: string;
  color: string;
  powerLevel: number;
  permissions: RoomCustomRolePermissions;
  createdAt: string;
}

export type RoomCustomRoleErrorCode =
  | "INVALID_REQUEST"
  | "ROOM_NOT_FOUND"
  | "NOT_ALLOWED"
  | "ROLE_NOT_FOUND"
  | "NAME_CONFLICT";

const ROOM_CUSTOM_ROLE_ERROR_STATUS: Record<RoomCustomRoleErrorCode, number> = {
  INVALID_REQUEST: 422,
  ROOM_NOT_FOUND: 404,
  NOT_ALLOWED: 403,
  ROLE_NOT_FOUND: 404,
  NAME_CONFLICT: 409,
};

export class RoomCustomRoleServiceError extends Error {
  readonly statusCode: number;

  constructor(readonly code: RoomCustomRoleErrorCode) {
    super(code);
    this.name = "RoomCustomRoleServiceError";
    this.statusCode = ROOM_CUSTOM_ROLE_ERROR_STATUS[code];
  }
}

interface RoomCustomRoleRow {
  id: string;
  name: string;
  color: string;
  power_level: number;
  permissions: RoomCustomRolePermissions;
  created_at: Date | string;
}

const toPublicRoomCustomRole = (row: RoomCustomRoleRow): RoomCustomRole => ({
  id: String(row.id),
  name: row.name,
  color: row.color,
  powerLevel: Number(row.power_level),
  permissions: row.permissions,
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
});

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505";

export function createRoomCustomRoleService(database: RoomCustomRoleDatabase = dbPool) {
  const resolveOwnedRoomId = async (roomRef: string, actorUserId: string): Promise<string> => {
    const normalizedRoomRef = roomRef.trim();
    const normalizedActorId = actorUserId.trim();
    if (!normalizedRoomRef || normalizedRoomRef.length > 128 || !normalizedActorId) {
      throw new RoomCustomRoleServiceError("INVALID_REQUEST");
    }

    const roomResult = await database.query(
      `SELECT CAST(id AS text) AS id, owner_id, owner, "user" AS legacy_user
       FROM rooms
       WHERE CAST(id AS text) = $1 OR slug = $1
       ORDER BY CASE WHEN CAST(id AS text) = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [normalizedRoomRef],
    );
    const room = roomResult.rows[0] as {
      id: string;
      owner_id: string | null;
      owner?: string | null;
      legacy_user?: string | null;
    } | undefined;
    if (!room) throw new RoomCustomRoleServiceError("ROOM_NOT_FOUND");

    let ownerUserId = room.owner_id ? String(room.owner_id) : "";
    if (!ownerUserId) {
      const ownerReference = String(room.owner || room.legacy_user || "")
        .replace(/^#+/, "")
        .trim();
      if (ownerReference) {
        const ownerResult = await database.query(
          `SELECT CAST(id AS text) AS id
           FROM users
           WHERE CAST(id AS text) = $1
              OR CAST(idreg AS text) = $1
              OR LOWER(username) = LOWER($1)
           ORDER BY CASE
             WHEN CAST(id AS text) = $1 THEN 0
             WHEN CAST(idreg AS text) = $1 THEN 1
             ELSE 2
           END
           LIMIT 1`,
          [ownerReference],
        );
        ownerUserId = ownerResult.rows[0]?.id ? String(ownerResult.rows[0].id) : "";
      }
    }

    if (ownerUserId !== normalizedActorId) {
      throw new RoomCustomRoleServiceError("NOT_ALLOWED");
    }

    return String(room.id);
  };

  const listForRoom = async (roomRef: string, actorUserId: string): Promise<RoomCustomRole[]> => {
    const roomId = await resolveOwnedRoomId(roomRef, actorUserId);
    const result = await database.query(
      `SELECT id, name, color, power_level, permissions, created_at
       FROM room_custom_roles
       WHERE room_id = $1
       ORDER BY power_level DESC, created_at ASC, id ASC`,
      [roomId],
    );
    return result.rows.map((row) => toPublicRoomCustomRole(row as RoomCustomRoleRow));
  };

  const createForRoom = async (
    roomRef: string,
    actorUserId: string,
    input: CreateRoomCustomRoleInput,
  ): Promise<RoomCustomRole> => {
    const roomId = await resolveOwnedRoomId(roomRef, actorUserId);
    try {
      const result = await database.query(
        `INSERT INTO room_custom_roles (room_id, name, color, power_level, permissions)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, name, color, power_level, permissions, created_at`,
        [roomId, input.name, input.color, input.powerLevel, JSON.stringify(input.permissions)],
      );
      return toPublicRoomCustomRole(result.rows[0] as RoomCustomRoleRow);
    } catch (error) {
      if (isUniqueViolation(error)) throw new RoomCustomRoleServiceError("NAME_CONFLICT");
      throw error;
    }
  };

  const updateForRoom = async (
    roomRef: string,
    actorUserId: string,
    roleId: string,
    input: UpdateRoomCustomRoleInput,
  ): Promise<RoomCustomRole> => {
    const roomId = await resolveOwnedRoomId(roomRef, actorUserId);
    try {
      const result = await database.query(
        `UPDATE room_custom_roles
         SET name = COALESCE($3, name),
             color = COALESCE($4, color),
             power_level = COALESCE($5, power_level),
             permissions = permissions || COALESCE($6::jsonb, '{}'::jsonb)
         WHERE room_id = $1 AND id = $2
         RETURNING id, name, color, power_level, permissions, created_at`,
        [
          roomId,
          roleId,
          input.name ?? null,
          input.color ?? null,
          input.powerLevel ?? null,
          input.permissions ? JSON.stringify(input.permissions) : null,
        ],
      );
      if (!result.rows[0]) throw new RoomCustomRoleServiceError("ROLE_NOT_FOUND");
      return toPublicRoomCustomRole(result.rows[0] as RoomCustomRoleRow);
    } catch (error) {
      if (error instanceof RoomCustomRoleServiceError) throw error;
      if (isUniqueViolation(error)) throw new RoomCustomRoleServiceError("NAME_CONFLICT");
      throw error;
    }
  };

  const deleteForRoom = async (
    roomRef: string,
    actorUserId: string,
    roleId: string,
  ): Promise<void> => {
    const roomId = await resolveOwnedRoomId(roomRef, actorUserId);
    const result = await database.query(
      `DELETE FROM room_custom_roles
       WHERE room_id = $1 AND id = $2
       RETURNING id`,
      [roomId, roleId],
    );
    if (!result.rows[0]) throw new RoomCustomRoleServiceError("ROLE_NOT_FOUND");
  };

  return { listForRoom, createForRoom, updateForRoom, deleteForRoom };
}

export const roomCustomRoleService = createRoomCustomRoleService();
