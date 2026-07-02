import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message };
  }

  const query = getQuery(event);
  const search = String(query.search || "").trim();

  try {
    const params: unknown[] = [];
    let where = "WHERE COALESCE(r.deleted, 0) = 0";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (r.topic ILIKE $1 OR r.id ILIKE $1 OR r.owner ILIKE $1 OR r.about ILIKE $1)`;
    }

    const results = await dbPool.query(
      `SELECT
         r.idroom AS id,
         r.id AS slug,
         r.topic AS name,
         r.about AS description,
         COALESCE(r.needpass, 0) = 0 AS "isPublic",
         r.max AS "maxMembers",
         r.mic AS "micSlots",
         r.pic AS "avatarUrl",
         r.owner,
         u.topic AS "ownerName",
         r.color,
         r.welcome,
         r.broadcast,
         r.deleted,
         r.stage_count AS "stageCount",
         r.message_mode AS "messageMode",
         r.rmli AS "likesRequired",
         r.stage_state AS "stageState",
         r.room_owner_meta AS "roomOwnerMeta",
         COALESCE(r.verified, false) AS "verified",
         COALESCE(r.room_layout, 'normal') AS "roomLayout"
       FROM rooms r
       LEFT JOIN users u ON r.owner = CONCAT('#', u.idreg::text)
       ${where}
       ORDER BY r.idroom DESC
       LIMIT 100`,
      params,
    );

    return {
      success: true,
      rooms: results.rows
    };
  } catch (err: any) {
    console.error("Admin rooms error:", err);
    return { success: false, error: err.message };
  }
});
