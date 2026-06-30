import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  try {
    await guardAdminAction(event, "ban");

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
        u.topic AS "displayName",
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
        OR LOWER(u.topic) LIKE LOWER($1)
        OR CAST(u.idreg AS text) LIKE $1
        OR u.ip LIKE $1
      ORDER BY u.lastssen DESC NULLS LAST
      LIMIT 20`,
      [searchPattern],
    );

    const users = result.rows.map((row: any) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName || row.username,
      power: row.power,
      ip: row.ip || "",
      fingerprint: row.fingerprint || "",
      deviceSignature: row.deviceSignature || "",
      countryCode: row.countryCode || "SA",
      avatar: row.avatar || "/pic.png",
      idreg: row.idreg,
      uid: row.uid,
      lastActive: row.lastActive ? new Date(Number(row.lastActive)).toISOString() : null,
      role: row.role || "member",
    }));

    return { success: true, users };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});
