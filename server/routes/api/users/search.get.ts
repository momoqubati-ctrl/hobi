import { defineEventHandler, getQuery, setResponseStatus, getHeader } from "h3";
import { dbPool } from "../../../db";
import { verifyAuthToken } from "../../../services/authService";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const authHeader = getHeader(event, "authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const claims = token ? verifyAuthToken(token) : null;
    if (!claims) {
      setResponseStatus(event, 401);
      return { success: false, message: "غير مصرح" };
    }

    const query = getQuery(event);
    const search = String(query.q || "").trim();

    if (search.length < 1) {
      return { success: true, users: [] };
    }

    const searchPattern = `%${search}%`;
    const cleanPublicId = search.toUpperCase();

    // Search by display_name, mention_name, or public_user_id (NEVER exposing username)
    const result = await dbPool.query(
      `SELECT
        u.id,
        u.display_name AS "displayName",
        u.mention_name AS "mentionName",
        u.public_user_id AS "publicUserId",
        u.pic AS "avatar",
        u.idreg,
        u.role
      FROM users u
      WHERE
        LOWER(u.display_name) LIKE LOWER($1)
        OR LOWER(u.mention_name) LIKE LOWER($1)
        OR u.public_user_id = $2
      ORDER BY u.lastssen DESC NULLS LAST
      LIMIT 30`,
      [searchPattern, cleanPublicId],
    );

    return {
      success: true,
      users: result.rows.map((r: any) => ({
        id: r.id,
        displayName: r.displayName,
        mentionName: r.mentionName || "",
        publicUserId: r.publicUserId || "",
        avatar: r.avatar || "/pic.png",
        idreg: r.idreg,
        role: r.role,
      })),
    };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
