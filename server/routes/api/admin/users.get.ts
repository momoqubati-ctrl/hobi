import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message, error: admin.message };
  }

  const query = getQuery(event);
  const search = String(query.search || "").trim();

  try {
    const params: unknown[] = [];
    let where = "";
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE username ILIKE $1 OR topic ILIKE $1 OR uid ILIKE $1 OR power ILIKE $1`;
    }

    const results = await dbPool.query(
      `SELECT
         idreg,
         id,
         uid,
         lid,
         username,
         topic AS "displayName",
         power AS role,
         CASE WHEN muted = 1 THEN 'muted' ELSE 'active' END AS status,
         pic AS "avatarUrl",
         ip,
         fp,
         rep,
         coins,
         evaluation,
         documentationc,
         lastssen AS "lastSeen",
         joinuser AS "createdAt"
       FROM users
       ${where}
       ORDER BY idreg DESC
       LIMIT 100`,
      params,
    );

    return {
      success: true,
      users: results.rows
    };
  } catch (err: any) {
    return handleApiError(event, err);
  }
});
