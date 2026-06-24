import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  try {
    await guardAdminAction(event, "cp");

    const query = getQuery(event);
    const search = String(query.search || "").trim();
    const limit = Math.min(Number(query.limit) || 150, 500);

    let where = "";
    const params: any[] = [limit];

    if (search) {
      params.push(`%${search}%`);
      where = `WHERE l.state ILIKE $2 OR l.topic ILIKE $2 OR l.username ILIKE $2 OR l.ip ILIKE $2 OR l.device ILIKE $2`;
    }

    // ربط جدول السجلات بجدول المستخدمين لجلب حالة التوثيق (documentationc)
    const result = await dbPool.query(
      `SELECT 
        l.id,
        l.state,
        l.topic,
        l.username,
        l.ip,
        l.code,
        l.device,
        l.isin,
        l."time" as "createdAt",
        CASE WHEN u.documentationc = true THEN 1 ELSE 0 END as "isVerified"
       FROM logs l
       LEFT JOIN users u ON l.username = u.username
       ${where}
       ORDER BY l."time" DESC
       LIMIT $1`,
      params
    );

    return { success: true, logs: result.rows };
  } catch (error: any) {
    console.error("[access-logs] Error:", error?.message || error);
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});