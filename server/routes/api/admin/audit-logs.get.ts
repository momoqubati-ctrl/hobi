import { defineEventHandler, getQuery } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    await guardAdminAction(event, "owner");

    const query = getQuery(event);
    const limit = Math.min(Number(query.limit) || 50, 100);
    const offset = Number(query.offset) || 0;

    const result = await dbPool.query(
      `SELECT 
        al.id,
        al.action,
        al.target_type as "targetType",
        al.target_id as "targetId",
        al.metadata,
        al.created_at as "createdAt",
        COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), u.username) as "actorName",
        u.power as "actorRole"
       FROM admin_audit_logs al
       LEFT JOIN users u ON al.actor_id = u.id
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return { success: true, logs: result.rows };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
