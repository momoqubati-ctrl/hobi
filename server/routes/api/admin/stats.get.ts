import { defineEventHandler, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message };
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
    console.error("Admin stats error:", err);
    return { success: false, error: err.message };
  }
});
