import { defineEventHandler, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message, error: admin.message };
  }

  try {
    const safeCount = async (table: string, where = "") => {
      try {
        const r = await dbPool.query(`SELECT count(*)::int AS value FROM ${table} ${where}`);
        return r.rows[0]?.value || 0;
      } catch {
        return 0;
      }
    };

    const [usersCount, bannedCount, roomsCount, reportsCount] = await Promise.all([
      safeCount("users"),
      safeCount("band"),
      safeCount("rooms", "WHERE COALESCE(deleted, 0) = 0"),
      safeCount("stats"),
    ]);

    return {
      success: true,
      stats: {
        users: usersCount,
        banned: bannedCount,
        rooms: roomsCount,
        reports: reportsCount,
      }
    };
  } catch (err: any) {
    return handleApiError(event, err);
  }
});
