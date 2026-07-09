import { defineEventHandler, getQuery } from "h3";
import { listRooms } from "../../services/chatStore";
import { getRoomMemberCount } from "../../socket/presenceManager";
import { dbPool } from "../../db";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string | undefined;

  const rooms = await listRooms();

  let likedRoomIds = new Set<string>();
  if (userId) {
    try {
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS "room_likes" (
          "room_id" varchar(255) NOT NULL,
          "user_id" varchar(255) NOT NULL,
          "created_at" timestamptz DEFAULT now() NOT NULL,
          PRIMARY KEY ("room_id", "user_id")
        );
      `);
      const likesResult = await dbPool.query(
        `SELECT room_id FROM room_likes WHERE user_id = $1`,
        [String(userId)]
      );
      likedRoomIds = new Set(likesResult.rows.map((r) => String(r.room_id)));
    } catch (_) {}
  }

  let likeCounts: Record<string, number> = {};
  try {
    const countsResult = await dbPool.query(
      `SELECT room_id, COUNT(*) as cnt FROM room_likes GROUP BY room_id`
    );
    for (const row of countsResult.rows) {
      likeCounts[String(row.room_id)] = Number(row.cnt);
    }
  } catch (_) {}

  const roomsWithCounts = await Promise.all(
    rooms.map(async (room: any) => {
      const liveCount = await getRoomMemberCount(room.id);
      const dbLikeCount = likeCounts[room.id] || 0;
      return {
        ...room,
        members: liveCount,
        likes: dbLikeCount || room.likes || 0,
        userLiked: likedRoomIds.has(room.id),
      };
    })
  );

  return {
    success: true,
    rooms: roomsWithCounts.sort((a: any, b: any) => (b.members || 0) - (a.members || 0)),
  };
});
