import { defineEventHandler, getHeader, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { verifyAuthToken } from "../../../services/authService";

export default defineEventHandler(async (event) => {
  // 1. Enforce authentication — Phase 0 Security Gate
  const authHeader = getHeader(event, "authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const claims = token ? verifyAuthToken(token) : null;
  if (!claims) {
    setResponseStatus(event, 401);
    return { success: false, message: "غير مصرح" };
  }

  const query = getQuery(event);
  const q = String(query.q || "").trim();

  if (q.length < 2) {
    setResponseStatus(event, 400);
    return { success: false, message: "q يجب أن يكون حرفين على الأقل" };
  }

  try {
    const searchPattern = `%${q}%`;
    const cleanPublicId = q.toUpperCase();

    // 2. Search strictly by display_name, mention_name, or exact public_user_id (NEVER exposing username)
    const result = await dbPool.query(
      `SELECT 
         id, 
         display_name AS "displayName", 
         mention_name AS "mentionName", 
         public_user_id AS "publicUserId", 
         pic AS "avatar", 
         role
       FROM users
       WHERE LOWER(display_name) LIKE LOWER($1)
          OR LOWER(mention_name) LIKE LOWER($1)
          OR public_user_id = $2
       ORDER BY display_name ASC
       LIMIT 10`,
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
        role: r.role,
      })) 
    };
  } catch (error) {
    console.error("searchUsers error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر البحث" };
  }
});
