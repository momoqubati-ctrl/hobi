import assert from "node:assert/strict";
import { getResponseStatus, mockEvent } from "h3";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import { roomCustomRoles, roomMembers } from "../server/db/schema";
import { ensureRoomCustomRolesSchema } from "../server/db/migrate";
import { createRoomCustomRoleHandlers } from "../server/services/roomCustomRoleApi";
import {
  DEFAULT_ROOM_CUSTOM_ROLE_PERMISSIONS,
  createRoomCustomRoleSchema,
  createRoomCustomRoleService,
  canPerformRoomCustomRoleAction,
  RoomCustomRoleServiceError,
  roomMemberRoleAssignmentSchema,
  updateRoomCustomRoleSchema,
  type RoomCustomRoleDatabase,
} from "../server/services/roomCustomRoleService";

test("room custom roles store room-scoped permissions and member assignments", () => {
  const roleConfig = getTableConfig(roomCustomRoles);
  const memberConfig = getTableConfig(roomMembers);

  assert.equal(roleConfig.name, "room_custom_roles");
  assert.ok(roleConfig.columns.some((column) => column.name === "room_id"));
  assert.ok(roleConfig.columns.some((column) => column.name === "power_level"));
  assert.ok(roleConfig.columns.some((column) => column.name === "permissions"));
  assert.ok(roleConfig.checks.some((constraint) => constraint.name === "room_custom_roles_permissions_check"));
  assert.ok(memberConfig.columns.some((column) => column.name === "custom_role_id"));
});

test("room custom role migration creates the table and member link idempotently", async () => {
  const statements: string[] = [];
  const client = {
    query: async (statement: string) => {
      statements.push(statement);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;

  await ensureRoomCustomRolesSchema(client);

  const migrationSql = statements.join("\n");
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS "room_custom_roles"/);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS "custom_role_id"/);
  assert.match(migrationSql, /ON DELETE SET NULL/);
});

test("custom role inputs default to no permissions and reject unknown or invalid fields", () => {
  const parsed = createRoomCustomRoleSchema.parse({ name: "مشرف المحتوى" });

  assert.equal(parsed.name, "مشرف المحتوى");
  assert.deepEqual(parsed.permissions, {
    canKick: false,
    canMute: false,
    canManageMics: false,
    canPin: false,
    canClearMessages: false,
    canBan: false,
  });
  assert.equal(createRoomCustomRoleSchema.safeParse({
    name: "غير صالح",
    permissions: { canKick: "yes" },
  }).success, false);
  assert.equal(createRoomCustomRoleSchema.safeParse({
    name: "غير صالح",
    canSetRole: true,
  }).success, false);
});

test("custom role updates support partial permission changes but reject empty patches", () => {
  assert.deepEqual(updateRoomCustomRoleSchema.parse({
    permissions: { canPin: true },
  }).permissions, { canPin: true });
  assert.equal(updateRoomCustomRoleSchema.safeParse({}).success, false);
  assert.equal(updateRoomCustomRoleSchema.safeParse({
    permissions: { canSetRole: true },
  }).success, false);
});

test("room member role assignment accepts a custom role or null to clear it", () => {
  const memberId = "member-1";
  const roleId = "baeb135c-970b-4ee2-9e7e-cfe1510c2e9b";

  assert.deepEqual(roomMemberRoleAssignmentSchema.parse({ customRoleId: roleId }), {
    customRoleId: roleId,
  });
  assert.deepEqual(roomMemberRoleAssignmentSchema.parse({ customRoleId: null }), {
    customRoleId: null,
  });
  assert.equal(roomMemberRoleAssignmentSchema.safeParse({ customRoleId: memberId }).success, false);
  assert.equal(roomMemberRoleAssignmentSchema.safeParse({ customRoleId: null, userId: "owner-1" }).success, false);
});

test("custom role actions require the permission and a strictly lower-ranked target", () => {
  const permissions = {
    canKick: true,
    canMute: false,
    canManageMics: false,
    canPin: false,
    canClearMessages: false,
    canBan: false,
  };
  const actor = {
    userId: "moderator",
    isOwner: false,
    powerLevel: 3000,
    globalRole: "member",
    permissions,
  };
  const member = {
    userId: "member",
    isOwner: false,
    powerLevel: 1000,
    globalRole: "member",
    permissions: DEFAULT_ROOM_CUSTOM_ROLE_PERMISSIONS,
  };
  const peer = { ...member, userId: "peer", powerLevel: 3000 };
  const owner = { ...member, userId: "owner", isOwner: true, powerLevel: 100000 };
  const siteAdmin = { ...member, userId: "site-admin", globalRole: "admin", powerLevel: 1 };
  const protectedSiteOwner = { ...member, userId: "site-owner", globalRole: "owner", powerLevel: 1 };

  assert.equal(canPerformRoomCustomRoleAction(actor, member, "canKick"), true);
  assert.equal(canPerformRoomCustomRoleAction(actor, peer, "canKick"), false);
  assert.equal(canPerformRoomCustomRoleAction(actor, member, "canMute"), false);
  assert.equal(canPerformRoomCustomRoleAction(actor, owner, "canKick"), false);
  assert.equal(canPerformRoomCustomRoleAction(owner, actor, "canKick"), true);
  assert.equal(canPerformRoomCustomRoleAction(siteAdmin, member, "canKick"), true);
  assert.equal(canPerformRoomCustomRoleAction(siteAdmin, protectedSiteOwner, "canKick"), false);
});

test("custom role listing refuses non-owners before reading role data", async () => {
  const statements: string[] = [];
  const database = {
    query: async (statement: string) => {
      statements.push(statement);
      if (statement.includes("FROM rooms")) {
        return { rows: [{ id: "room-id", owner_id: "owner-1" }] };
      }
      if (statement.includes("FROM room_members")) return { rows: [] };
      return { rows: [] };
    },
  } as unknown as RoomCustomRoleDatabase;
  const service = createRoomCustomRoleService(database);

  await assert.rejects(
    service.listForRoom("room-slug", "member-2"),
    (error: unknown) => error instanceof RoomCustomRoleServiceError && error.code === "NOT_ALLOWED",
  );
  assert.equal(statements.length, 1);
});

test("custom role access resolves legacy room-owner references to user IDs", async () => {
  const statements: string[] = [];
  const database = {
    query: async (statement: string) => {
      statements.push(statement);
      if (statement.includes("FROM rooms")) {
        return { rows: [{ id: "room-id", owner_id: null, owner: "#owner-reg" }] };
      }
      if (statement.includes("FROM users")) {
        return { rows: [{ id: "owner-1" }] };
      }
      return { rows: [] };
    },
  } as unknown as RoomCustomRoleDatabase;
  const service = createRoomCustomRoleService(database);

  assert.deepEqual(await service.listForRoom("room-slug", "owner-1"), []);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /CAST\(idreg AS text\) = \$1/);
});

test("room custom role CRUD always scopes changes to the owner room", async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const database = {
    query: async (text: string, values?: unknown[]) => {
      statements.push({ text, values });
      if (text.includes("FROM rooms")) {
        return { rows: [{ id: "room-id", owner_id: "owner-1" }] };
      }
      if (text.includes("INSERT INTO room_custom_roles")) {
        return {
          rows: [{
            id: "role-id",
            name: "إدارة خاصة",
            color: "#64748b",
            power_level: 2000,
            permissions: {
              canKick: false,
              canMute: false,
              canManageMics: false,
              canPin: false,
              canClearMessages: false,
              canBan: false,
            },
            created_at: new Date("2026-11-08T00:00:00.000Z"),
          }],
        };
      }
      if (text.includes("UPDATE room_custom_roles")) {
        return {
          rows: [{
            id: "role-id",
            name: "إدارة خاصة",
            color: "#64748b",
            power_level: 2000,
            permissions: {
              canKick: false,
              canMute: false,
              canManageMics: false,
              canPin: true,
              canClearMessages: false,
              canBan: false,
            },
            created_at: new Date("2026-11-08T00:00:00.000Z"),
          }],
        };
      }
      return { rows: [{ id: "role-id" }] };
    },
  } as unknown as RoomCustomRoleDatabase;
  const service = createRoomCustomRoleService(database);

  const role = await service.createForRoom(
    "room-slug",
    "owner-1",
    createRoomCustomRoleSchema.parse({ name: "إدارة خاصة", powerLevel: 2000 }),
  );
  await service.updateForRoom(
    "room-slug",
    "owner-1",
    "role-id",
    updateRoomCustomRoleSchema.parse({ permissions: { canPin: true } }),
  );
  await service.deleteForRoom("room-slug", "owner-1", "role-id");

  assert.equal(role.id, "role-id");
  assert.equal(statements.filter(({ text }) => text.includes("FROM rooms")).length, 3);
  const insert = statements.find(({ text }) => text.includes("INSERT INTO room_custom_roles"));
  const update = statements.find(({ text }) => text.includes("UPDATE room_custom_roles"));
  const remove = statements.find(({ text }) => text.includes("DELETE FROM room_custom_roles"));
  assert.ok(insert);
  assert.ok(update);
  assert.ok(remove);
  assert.deepEqual(insert.values?.slice(0, 4), [
    "room-id",
    "إدارة خاصة",
    "#64748b",
    2000,
  ]);
  assert.doesNotMatch(insert.text, /إدارة خاصة/);
  assert.match(update.text, /WHERE room_id = \$1 AND id = \$2/);
  assert.match(remove.text, /WHERE room_id = \$1 AND id = \$2/);
});

test("room owners cannot assign a role to a member who is not currently connected", async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const database = {
    query: async (text: string, values?: unknown[]) => {
      statements.push({ text, values });
      if (text.includes("FROM rooms")) {
        return { rows: [{ id: "room-id", owner_id: "owner-1" }] };
      }
      if (text.includes("FROM room_custom_roles")) {
        return {
          rows: [{
            id: "role-1",
            name: "إدارة",
            color: "#64748b",
            power_level: 2000,
            permissions: {
              canKick: true,
              canMute: false,
              canManageMics: false,
              canPin: false,
              canClearMessages: false,
              canBan: false,
            },
            created_at: new Date("2026-11-08T00:00:00.000Z"),
          }],
        };
      }
      if (text.includes("INSERT INTO room_members")) {
        return { rows: [{ user_id: "member-1" }] };
      }
      return { rows: [] };
    },
  };
  const service = createRoomCustomRoleService(database, async () => false);

  await assert.rejects(
    service.assignMemberRole("room-slug", "owner-1", "member-1", "role-1"),
    { message: "MEMBER_NOT_FOUND" },
  );
  assert.equal(
    statements.some(({ text }) => text.includes("room_members")),
    false,
  );
});

test("room owners can assign only a role belonging to their room to an existing member", async () => {
  const statements: Array<{ text: string; values?: unknown[] }> = [];
  const database = {
    query: async (text: string, values?: unknown[]) => {
      statements.push({ text, values });
      if (text.includes("FROM rooms")) {
        return { rows: [{ id: "room-id", owner_id: "owner-1" }] };
      }
      if (text.includes("FROM room_custom_roles")) {
        return {
          rows: [{
            id: "role-1",
            name: "إدارة",
            color: "#64748b",
            power_level: 2000,
            permissions: DEFAULT_ROOM_CUSTOM_ROLE_PERMISSIONS,
            created_at: new Date("2026-11-08T00:00:00.000Z"),
          }],
        };
      }
      if (text.includes("INSERT INTO room_members")) {
        return { rows: [{ user_id: "member-1" }] };
      }
      return { rows: [] };
    },
  } as unknown as RoomCustomRoleDatabase;
  const service = createRoomCustomRoleService(database);

  const assigned = await service.assignMemberRole("room-slug", "owner-1", "member-1", "role-1");

  assert.equal(assigned.roomId, "room-id");
  assert.equal(assigned.userId, "member-1");
  assert.equal(assigned.customRoleId, "role-1");
  assert.equal(assigned.customRole?.name, "إدارة");
  const roleCheck = statements.find(({ text }) => text.includes("FROM room_custom_roles"));
  const assignment = statements.find(({ text }) => text.includes("INSERT INTO room_members"));
  assert.deepEqual(roleCheck?.values, ["room-id", "role-1"]);
  assert.deepEqual(assignment?.values, ["room-id", "member-1", "role-1"]);
  assert.match(assignment?.text || "", /FROM users/);
  assert.match(assignment?.text || "", /ON CONFLICT \(room_id, user_id\)/);
});

test("room role assignment rejects a role from another room and missing members", async () => {
  let updateAttempted = false;
  const database = {
    query: async (text: string) => {
      if (text.includes("FROM rooms")) return { rows: [{ id: "room-id", owner_id: "owner-1" }] };
      if (text.includes("FROM room_custom_roles")) return { rows: [] };
      if (text.includes("INSERT INTO room_members")) {
        updateAttempted = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as unknown as RoomCustomRoleDatabase;
  const service = createRoomCustomRoleService(database);

  await assert.rejects(
    service.assignMemberRole("room-slug", "owner-1", "member-1", "role-from-other-room"),
    (error: unknown) => error instanceof RoomCustomRoleServiceError && error.code === "ROLE_NOT_FOUND",
  );
  assert.equal(updateAttempted, false);

  const memberDatabase = {
    query: async (text: string) => {
      if (text.includes("FROM rooms")) return { rows: [{ id: "room-id", owner_id: "owner-1" }] };
      if (text.includes("FROM room_custom_roles")) {
        return {
          rows: [{
            id: "role-1",
            name: "إدارة",
            color: "#64748b",
            power_level: 2000,
            permissions: DEFAULT_ROOM_CUSTOM_ROLE_PERMISSIONS,
            created_at: new Date("2026-11-08T00:00:00.000Z"),
          }],
        };
      }
      if (text.includes("INSERT INTO room_members")) return { rows: [] };
      return { rows: [] };
    },
  } as unknown as RoomCustomRoleDatabase;
  const memberService = createRoomCustomRoleService(memberDatabase);
  await assert.rejects(
    memberService.assignMemberRole("room-slug", "owner-1", "unknown-member", "role-1"),
    (error: unknown) => error instanceof RoomCustomRoleServiceError && error.code === "MEMBER_NOT_FOUND",
  );
});

test("room role API rejects guests before reaching the service", async () => {
  let calls = 0;
  const service = {
    listForRoom: async () => {
      calls += 1;
      return [];
    },
    listMemberAssignmentsForRoom: async () => {
      calls += 1;
      return [];
    },
  };
  const handlers = createRoomCustomRoleHandlers(
    service as never,
    () => ({ ok: true, userId: "guest-1", username: "guest", role: "guest" }) as never,
  );
  const event = mockEvent("/api/rooms/room-a/roles", { method: "GET" });
  event.context.params = { roomId: "room-a" };

  await handlers.list(event);

  assert.equal(getResponseStatus(event), 403);
  assert.equal(calls, 0);
});

test("room role API rejects client-supplied actor identity fields", async () => {
  let received: unknown[] | undefined;
  const service = {
    createForRoom: async (...args: unknown[]) => {
      received = args;
      return { id: "role-1", name: "إدارة", color: "#64748b", powerLevel: 1000, permissions: {}, createdAt: "" };
    },
  };
  const handlers = createRoomCustomRoleHandlers(
    service as never,
    () => ({ ok: true, userId: "owner-1", username: "owner", role: "member" }) as never,
  );
  const event = mockEvent("/api/rooms/room-a/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: " إدارة ", actorUserId: "attacker" }),
  });
  event.context.params = { roomId: "room-a" };

  await handlers.create(event);

  assert.equal(getResponseStatus(event), 422);
  assert.equal(received, undefined);
});

test("room role API passes the authenticated account and normalized input to creation", async () => {
  let received: unknown[] | undefined;
  const service = {
    createForRoom: async (...args: unknown[]) => {
      received = args;
      return {
        id: "role-1",
        name: "إدارة",
        color: "#64748b",
        powerLevel: 1000,
        permissions: {
          canKick: false,
          canMute: false,
          canManageMics: false,
          canPin: false,
          canClearMessages: false,
          canBan: false,
        },
        createdAt: "2026-11-08T00:00:00.000Z",
      };
    },
  };
  const handlers = createRoomCustomRoleHandlers(
    service as never,
    () => ({ ok: true, userId: "owner-1", username: "owner", role: "member" }) as never,
  );
  const event = mockEvent("/api/rooms/room-a/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: " إدارة " }),
  });
  event.context.params = { roomId: "room-a" };

  await handlers.create(event);

  assert.equal(getResponseStatus(event), 201);
  assert.equal(received?.[0], "room-a");
  assert.equal(received?.[1], "owner-1");
  assert.equal((received?.[2] as { name: string }).name, "إدارة");
});

test("room role API derives the actor from auth and validates assignment input", async () => {
  let received: unknown[] | undefined;
  const handlers = createRoomCustomRoleHandlers(
    {
      assignMemberRole: async (...args: unknown[]) => {
        received = args;
        return { roomId: "room-id", userId: "member-1", customRoleId: null, customRole: null };
      },
    } as never,
    () => ({ ok: true, userId: "owner-1", username: "owner", role: "member" }) as never,
  );
  const event = mockEvent("/api/rooms/room-a/members/member-1/role", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customRoleId: null }),
  });
  event.context.params = { roomId: "room-a", memberId: "member-1" };

  await handlers.assignMemberRole(event);

  assert.equal(getResponseStatus(event), 200);
  assert.deepEqual(received, ["room-a", "owner-1", "member-1", null]);
});
