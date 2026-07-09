import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../../db";

const ensureTable = async () => {
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS "room_likes" (
        "room_id" varchar(255) NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("room_id", "user_id")
      );
    `);
  } catch (_) {}
};

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { roomId, userId } = body;

  if (!roomId || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "roomId و userId مطلوبان" };
  }

  await ensureTable();

  try {
    const existing = await dbPool.query(
      `SELECT 1 FROM room_likes WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [String(roomId), String(userId)]
    );

    if (existing.rows.length > 0) {
      await dbPool.query(
        `DELETE FROM room_likes WHERE room_id = $1 AND user_id = $2`,
        [String(roomId), String(userId)]
      );
      try {
        await dbPool.query(
          `UPDATE rooms SET rmli = GREATEST(COALESCE(rmli, 0) - 1, 0) WHERE CAST(id AS text) = $1 OR slug = $1`,
          [String(roomId)]
        );
      } catch (_) {}
      return { success: true, liked: false };
    } else {
      await dbPool.query(
        `INSERT INTO room_likes (room_id, user_id, created_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
        [String(roomId), String(userId)]
      );
      try {
        await dbPool.query(
          `UPDATE rooms SET rmli = COALESCE(rmli, 0) + 1 WHERE CAST(id AS text) = $1 OR slug = $1`,
          [String(roomId)]
        );
      } catch (_) {}
      return { success: true, liked: true };
    }
  } catch (error) {
    console.error("Toggle room like error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تعديل الإعجاب" };
  }
});
