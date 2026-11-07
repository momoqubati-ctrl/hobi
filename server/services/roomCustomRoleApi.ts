import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getUserAuthContext } from "./adminAccess";
import {
  createRoomCustomRoleSchema,
  roomCustomRoleService,
  RoomCustomRoleServiceError,
  updateRoomCustomRoleSchema,
  type CreateRoomCustomRoleInput,
  type UpdateRoomCustomRoleInput,
} from "./roomCustomRoleService";

type RoomCustomRoleService = typeof roomCustomRoleService;
type Authenticator = typeof getUserAuthContext;

const getRequestContext = (event: H3Event, authenticate: Authenticator) => {
  const auth = authenticate(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return {
      error: { success: false, code: "UNAUTHENTICATED", message: auth.message },
    } as const;
  }
  if (!auth.userId || auth.role.toLowerCase() === "guest") {
    setResponseStatus(event, 403);
    return {
      error: { success: false, code: "NOT_ALLOWED", message: "إدارة مجموعات الغرفة متاحة للمالك فقط" },
    } as const;
  }

  const roomRef = getRouterParam(event, "roomId")?.trim();
  if (!roomRef || roomRef.length > 128) {
    setResponseStatus(event, 400);
    return {
      error: { success: false, code: "INVALID_REQUEST", message: "معرف الغرفة غير صالح" },
    } as const;
  }

  return { roomRef, userId: auth.userId } as const;
};

const readValidatedBody = async <T>(
  event: H3Event,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
): Promise<T | null> => {
  let body: unknown;
  try {
    body = await readBody<unknown>(event);
  } catch {
    setResponseStatus(event, 400);
    return null;
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    setResponseStatus(event, 422);
    return null;
  }
  return result.data ?? null;
};

const getRoleId = (event: H3Event): string | null => {
  const roleId = getRouterParam(event, "roleId");
  if (
    typeof roleId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleId)
  ) {
    setResponseStatus(event, 422);
    return null;
  }
  return roleId;
};

const handleServiceError = (event: H3Event, error: unknown, action: string) => {
  if (error instanceof RoomCustomRoleServiceError) {
    setResponseStatus(event, error.statusCode);
    const messages = {
      INVALID_REQUEST: "بيانات الطلب غير صالحة",
      ROOM_NOT_FOUND: "الغرفة غير موجودة",
      NOT_ALLOWED: "لا تملك صلاحية إدارة مجموعات هذه الغرفة",
      ROLE_NOT_FOUND: "مجموعة الصلاحيات غير موجودة",
      NAME_CONFLICT: "يوجد مجموعة أخرى بالاسم نفسه",
    } satisfies Record<RoomCustomRoleServiceError["code"], string>;
    return { success: false, code: error.code, message: messages[error.code] };
  }

  console.error(`[RoomCustomRoles] Failed to ${action}:`, error);
  setResponseStatus(event, 500);
  return { success: false, code: "INTERNAL_ERROR", message: "تعذر حفظ مجموعات صلاحيات الغرفة" };
};

export function createRoomCustomRoleHandlers(
  service: RoomCustomRoleService = roomCustomRoleService,
  authenticate: Authenticator = getUserAuthContext,
) {
  const list = defineEventHandler(async (event) => {
    const context = getRequestContext(event, authenticate);
    if ("error" in context) return context.error;

    try {
      const roles = await service.listForRoom(context.roomRef, context.userId);
      return { success: true, roles };
    } catch (error) {
      return handleServiceError(event, error, "list roles");
    }
  });

  const create = defineEventHandler(async (event) => {
    const context = getRequestContext(event, authenticate);
    if ("error" in context) return context.error;

    const input = await readValidatedBody<CreateRoomCustomRoleInput>(event, createRoomCustomRoleSchema);
    if (!input) {
      return { success: false, code: "INVALID_REQUEST", message: "بيانات مجموعة الصلاحيات غير صالحة" };
    }

    try {
      const role = await service.createForRoom(context.roomRef, context.userId, input);
      setResponseStatus(event, 201);
      return { success: true, role };
    } catch (error) {
      return handleServiceError(event, error, "create role");
    }
  });

  const update = defineEventHandler(async (event) => {
    const context = getRequestContext(event, authenticate);
    if ("error" in context) return context.error;

    const roleId = getRoleId(event);
    if (!roleId) {
      return { success: false, code: "INVALID_REQUEST", message: "معرف مجموعة الصلاحيات غير صالح" };
    }
    const input = await readValidatedBody<UpdateRoomCustomRoleInput>(event, updateRoomCustomRoleSchema);
    if (!input) {
      return { success: false, code: "INVALID_REQUEST", message: "بيانات مجموعة الصلاحيات غير صالحة" };
    }

    try {
      const role = await service.updateForRoom(context.roomRef, context.userId, roleId, input);
      return { success: true, role };
    } catch (error) {
      return handleServiceError(event, error, "update role");
    }
  });

  const remove = defineEventHandler(async (event) => {
    const context = getRequestContext(event, authenticate);
    if ("error" in context) return context.error;

    const roleId = getRoleId(event);
    if (!roleId) {
      return { success: false, code: "INVALID_REQUEST", message: "معرف مجموعة الصلاحيات غير صالح" };
    }

    try {
      await service.deleteForRoom(context.roomRef, context.userId, roleId);
      return { success: true };
    } catch (error) {
      return handleServiceError(event, error, "delete role");
    }
  });

  return { list, create, update, remove };
}

export const roomCustomRoleHandlers = createRoomCustomRoleHandlers();
