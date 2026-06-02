import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const q = (query.q as string || "").trim();

  if (q.length < 2) {
    setResponseStatus(event, 400);
    return { success: false, message: "q يجب أن يكون حرفين على الأقل" };
  }

  try {
    const result = await dbPool.query(
      `SELECT id, username, topic, pic, role
       FROM users
       WHERE username ILIKE $1 OR topic ILIKE $1
       ORDER BY username ASC
       LIMIT 10`,
      [`%${q}%`],
    );

    return { success: true, users: result.rows };
  } catch (error) {
    console.error("searchUsers error:", error);
    return { success: false, message: "تعذر البحث" };
  }
});
