import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";
import { getUserAuthContext } from "../../../../services/adminAccess";
import { hasChatFeatureAccess } from "../../../../services/chatAuthorization";

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);

  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }
  const body = await readBody<Record<string, unknown> | null>(event);
  const roomId = body?.roomId;
  if ((typeof roomId !== "string" && typeof roomId !== "number") || !String(roomId).trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "roomId مطلوب" };
  }
  const normalizedRoomId = String(roomId).trim();
  if (normalizedRoomId.length > 255) {
    setResponseStatus(event, 400);
    return { success: false, message: "roomId غير صالح" };
  }
  if (!(await hasChatFeatureAccess({ id: auth.userId, role: auth.role }, ["room_reactions.use"]))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية التفاعل مع الغرف" };
  }

  try {
    const existing = await dbPool.query(
      `SELECT 1 FROM room_likes WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [normalizedRoomId, auth.userId]
    );

    if (existing.rows.length > 0) {
      await dbPool.query(
        `DELETE FROM room_likes WHERE room_id = $1 AND user_id = $2`,
        [normalizedRoomId, auth.userId]
      );
      try {
        await dbPool.query(
          `UPDATE rooms SET rmli = GREATEST(COALESCE(rmli, 0) - 1, 0) WHERE CAST(id AS text) = $1 OR slug = $1`,
          [normalizedRoomId]
        );
      } catch (error) {
        console.error("Update room like count failed:", error);
      }
      return { success: true, liked: false };
    } else {
      await dbPool.query(
        `INSERT INTO room_likes (room_id, user_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
        [normalizedRoomId, auth.userId]
      );
      try {
        await dbPool.query(
          `UPDATE rooms SET rmli = COALESCE(rmli, 0) + 1 WHERE CAST(id AS text) = $1 OR slug = $1`,
          [normalizedRoomId]
        );
      } catch (error) {
        console.error("Update room like count failed:", error);
      }
      return { success: true, liked: true };
    }
  } catch (error) {
    console.error("Toggle room like error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تعديل الإعجاب" };
  }
});
