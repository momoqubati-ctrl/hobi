import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { db } from "../../../db";
import { moderationEvents, users, rooms } from "../../../db/schema";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getAdminContext } from "../../../services/adminAccess";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message, error: admin.message };
  }

  const query = getQuery(event);

  try {
    const targetUsers = alias(users, "target_users");

    const results = await db
      .select({
        id: moderationEvents.id,
        eventType: moderationEvents.eventType,
        reason: moderationEvents.reason,
        createdAt: moderationEvents.createdAt,
        actorName: users.displayName,
        targetName: targetUsers.displayName,
        roomName: rooms.name
      })
      .from(moderationEvents)
      .leftJoin(users, eq(moderationEvents.actorId, users.id))
      .leftJoin(targetUsers, eq(moderationEvents.targetUserId, targetUsers.id))
      .leftJoin(rooms, eq(moderationEvents.roomId, rooms.id))
      .orderBy(desc(moderationEvents.createdAt))
      .limit(50);

    return {
      success: true,
      events: results
    };
  } catch (err: any) {
    return handleApiError(event, err);
  }
});
