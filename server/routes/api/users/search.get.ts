import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getHeader } from "h3";

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

export default defineEventHandler(async (event) => {
  try {
    const authHeader = getHeader(event, "authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
      setResponseStatus(event, 401);
      return { success: false, message: "غير مصرح" };
    }
    const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
    if (Buffer.from(expected).length !== Buffer.from(signature).length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      setResponseStatus(event, 401);
      return { success: false, message: "غير مصرح" };
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
        u.topic AS "displayName",
        u.pic AS "avatar",
        u.idreg
      FROM users u
      WHERE
        LOWER(u.username) LIKE LOWER($1)
        OR LOWER(u.topic) LIKE LOWER($1)
      ORDER BY u.lastssen DESC NULLS LAST
      LIMIT 30`,
      [searchPattern],
    );

    return {
      success: true,
      users: result.rows.map((r: any) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName || r.username,
        avatar: r.avatar || "/pic.png",
        idreg: r.idreg,
      })),
    };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { success: false, message: error.message };
  }
});
