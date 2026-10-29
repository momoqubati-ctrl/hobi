import { defineEventHandler, getQuery } from "h3";
import { listRooms } from "../../services/chatStore";
import { dbPool } from "../../db";
import https from "node:https";
import http from "node:http";

function fetchRoomCountsFromLocal(): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    // 1. Direct in-memory check if in same thread
    try {
      const io = (globalThis as any).__socket_io_instance__ || (process as any).__socket_io_instance__;
      if (io?.sockets?.adapter?.rooms) {
        const counts: Record<string, number> = {};
        for (const [name, s] of io.sockets.adapter.rooms.entries()) {
          if (name.startsWith("room:")) {
            counts[name.slice(5)] = s.size;
          }
        }
        if (Object.keys(counts).length > 0) {
          return resolve(counts);
        }
      }
    } catch (_) {}

    // 2. Query Vite middleware via HTTPS (supporting self-signed dev certificates)
    const req = https.get("https://127.0.0.1:3000/__room_counts__", { rejectUnauthorized: false, timeout: 2000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });

    req.on("error", () => {
      // 3. Fallback to HTTP if server is not using TLS
      const httpReq = http.get("http://127.0.0.1:3000/__room_counts__", { timeout: 2000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      });
      httpReq.on("error", () => resolve({}));
    });
  });
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string | undefined;

  const rooms = await listRooms();
  const liveCounts = await fetchRoomCountsFromLocal();

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

  const roomsWithCounts = rooms.map((room: any) => {
    const liveCount = Math.max(
      liveCounts[room.id] || 0,
      room.slug ? (liveCounts[room.slug] || 0) : 0,
      room.name ? (liveCounts[room.name] || 0) : 0
    );
    const dbLikeCount = likeCounts[room.id] || (room.slug ? likeCounts[room.slug] : 0) || 0;
    return {
      ...room,
      members: liveCount,
      likes: dbLikeCount || room.likes || 0,
      userLiked: likedRoomIds.has(room.id) || (room.slug ? likedRoomIds.has(room.slug) : false),
    };
  });

  return {
    success: true,
    rooms: roomsWithCounts.sort((a: any, b: any) => (b.members || 0) - (a.members || 0)),
  };
});
