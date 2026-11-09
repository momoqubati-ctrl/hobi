import { getUserAuthContext } from "./adminAccess";
import { dbPool } from "../db";
import type { H3Event } from "h3";
import { setResponseStatus } from "h3";

export const requireCoinPurchaseMember = async (event: H3Event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId || auth.role.toLowerCase() === "guest") {
    const statusCode = auth.ok ? 403 : 401;
    setResponseStatus(event, statusCode);
    return {
      ok: false as const,
      statusCode,
      message: auth.ok ? "شراء العملات متاح للأعضاء المسجلين فقط" : auth.message,
    };
  }

  const result = await dbPool.query<{ active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM "users"
       WHERE "id" = $1 AND "status" = 'active' AND "role" <> 'guest'
     ) AS "active"`,
    [auth.userId],
  );
  if (result.rows[0]?.active !== true) {
    setResponseStatus(event, 403);
    return {
      ok: false as const,
      statusCode: 403,
      message: "الحساب غير متاح لشراء العملات",
    };
  }
  return { ok: true as const, id: auth.userId, username: auth.username };
};
