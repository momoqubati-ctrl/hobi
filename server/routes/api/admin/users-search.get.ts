import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getUserAuthContext } from "../../../services/adminAccess";
import { getUserContext } from "../../../services/permissionEngine";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const auth = getUserAuthContext(event);
    if (!auth.ok) {
      setResponseStatus(event, auth.statusCode);
      return { success: false, message: auth.message };
    }

    let isAuthorized = false;
    let isFullModerator = false;

    if (auth.role === "owner" || auth.role === "admin") {
      isAuthorized = true;
      isFullModerator = true;
    } else {
      const userCtx = await getUserContext(auth.userId);
      if (
        userCtx.permissions.has("ban.read") ||
        userCtx.permissions.has("ban.edit") ||
        userCtx.permissions.has("ban.all") ||
        userCtx.permissions.has("admin_bans.read") ||
        userCtx.permissions.has("admin_bans.all")
      ) {
        isAuthorized = true;
        isFullModerator = true;
      } else if (
        userCtx.permissions.has("rooms.read") ||
        userCtx.permissions.has("rooms.edit") ||
        userCtx.permissions.has("rooms.all") ||
        userCtx.permissions.has("admin_rooms.read") ||
        userCtx.permissions.has("admin_rooms.edit") ||
        userCtx.permissions.has("admin_rooms.all") ||
        userCtx.permissions.has("roomowner.read") ||
        userCtx.permissions.has("roomowner.edit") ||
        userCtx.permissions.has("roomowner.all") ||
        userCtx.permissions.has("admin_users.read") ||
        userCtx.permissions.has("admin_users.all")
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      setResponseStatus(event, 403);
      return { success: false, message: "لا تملك صلاحية البحث عن الأعضاء" };
    }

    const query = getQuery(event);
    const search = String(query.q || "").trim();

    if (search.length < 1) {
      return { success: true, users: [] };
    }

    const searchPattern = `%${search}%`;

    const result = await dbPool.query(
      `SELECT
        u.id,
        u.username,
        COALESCE(NULLIF(u.display_name, ''), NULLIF(u.topic, ''), u.username) AS "displayName",
        u.mention_name AS "mentionName",
        u.public_user_id AS "publicUserId",
        u.power,
        u.ip,
        u.fp AS "fingerprint",
        u.device_signature AS "deviceSignature",
        u.country_code AS "countryCode",
        u.pic AS "avatar",
        u.idreg,
        u.uid,
        u.lastssen AS "lastActive",
        u."role"
      FROM users u
      WHERE
        LOWER(u.username) LIKE LOWER($1)
        OR LOWER(u.display_name) LIKE LOWER($1)
        OR LOWER(u.topic) LIKE LOWER($1)
        OR LOWER(u.mention_name) LIKE LOWER($1)
        OR u.public_user_id = $2
        OR CAST(u.idreg AS text) LIKE $1
        OR u.ip LIKE $1
      ORDER BY u.lastssen DESC NULLS LAST
      LIMIT 20`,
      [searchPattern, search],
    );

    const users = result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName || row.username,
      mentionName: row.mentionName || "",
      publicUserId: row.publicUserId || "",
      power: row.power,
      ip: isFullModerator ? (row.ip || "") : "",
      fingerprint: isFullModerator ? (row.fingerprint || "") : "",
      deviceSignature: isFullModerator ? (row.deviceSignature || "") : "",
      countryCode: row.countryCode || "SA",
      avatar: row.avatar || "/pic.png",
      idreg: row.idreg,
      uid: row.uid,
      lastActive: row.lastActive ? new Date(Number(row.lastActive)).toISOString() : null,
      role: row.role || "member",
    }));

    return { success: true, users };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
