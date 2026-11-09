import { dbPool } from "../db";

/**
 * خدمة الكتم الغرفي المنفصل عن الكتم العام.
 *
 * كان زر «كتم بالروم» يكتب الحقل العام users.muted متسبباً في كتم العضو
 * من كامل السايت (الغرف + الخاص + الجدار). هذه الخدمة تفصل الكتم لكل غرفة:
 * الخاص والجدار يبقيان تحت الكتم العام فقط، وكتم الغرفة يعيش في room_mutes.
 */

const clean = (value: unknown): string => String(value ?? "").trim();

/**
 * بناء تنويعات معرف الغرفة المحتملة (سليم معرفات قد تحمل بادئة room:/slug/قديمة).
 * دالة خالصة قابلة للاختبار — بنفس الحل المطبق في room_kick.
 */
export const deriveRoomIds = (
  canonicalRoomId: string,
  rawRoomId?: string,
): string[] => {
  const set = new Set<string>();
  for (const value of [canonicalRoomId, rawRoomId]) {
    const trimmed = clean(value);
    if (!trimmed) continue;
    set.add(trimmed);
    set.add(`room:${trimmed}`);
    const stripped = trimmed.startsWith("room:") ? trimmed.substring(5) : trimmed;
    if (stripped) set.add(stripped);
  }
  return Array.from(set).filter(Boolean);
};

export interface RoomMuteService {
  setRoomMute(params: { roomId: string; rawRoomId?: string; userId: string; mutedBy?: string; reason?: string; expiresAt?: Date | null }): Promise<boolean>;
  isRoomMutedForUser(roomIds: readonly string[], userId: string): Promise<boolean>;
  clearRoomMutesForUser(userId: string): Promise<number>;
  clearRoomMute(roomIds: readonly string[], userId: string): Promise<number>;
  getUserActiveRoomMutes(userId: string): Promise<Array<{ roomId: string; expiresAt: string | null }>>;
}

export function createRoomMuteService(pool = dbPool): RoomMuteService {
  return {
    async setRoomMute({ roomId, rawRoomId, userId, mutedBy, reason, expiresAt = null }) {
      const roomIds = deriveRoomIds(roomId, rawRoomId);
      const targetUserId = clean(userId);
      if (roomIds.length === 0 || !targetUserId) return false;

      // استثناء دول التكرار: فحص ما هو فعال مسبقاً لنفس الغرفة
      const existing = await pool.query(
        `SELECT room_id FROM room_mutes
          WHERE user_id = $2
            AND (room_id = ANY($1::text[]) OR lower(room_id) = ANY($3::text[]))
            AND (expires_at IS NULL OR expires_at > now())`,
        [roomIds, targetUserId, roomIds.map((r) => r.toLowerCase())],
      );
      const alreadyCovered = new Set<string>();
      for (const row of existing.rows) {
        alreadyCovered.add(String(row.room_id || "").toLowerCase());
      }

      // حذف المفعول المنتهي الباقي لتنويعات هذه الغرفة لتفادي التراكم
      await pool.query(
        `DELETE FROM room_mutes
          WHERE user_id = $2
            AND (room_id = ANY($1::text[]) OR lower(room_id) = ANY($3::text[]))
            AND expires_at IS NOT NULL AND expires_at <= now()`,
        [roomIds, targetUserId, roomIds.map((r) => r.toLowerCase())],
      );

      let inserted = false;
      for (const rid of roomIds) {
        if (alreadyCovered.has(rid.toLowerCase())) continue;
        await pool.query(
          `INSERT INTO room_mutes (room_id, user_id, muted_by, reason, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [rid, targetUserId, clean(mutedBy) || null, clean(reason) || null, expiresAt],
        );
        inserted = true;
      }
      return inserted || (existing.rowCount ?? 0) > 0;
    },

    async isRoomMutedForUser(roomIds, userId) {
      const filtered = Array.from(new Set(roomIds.map(clean).filter(Boolean)));
      if (filtered.length === 0 || !clean(userId)) return false;
      try {
        const result = await pool.query(
          `SELECT 1 FROM room_mutes
            WHERE user_id = $2
              AND (room_id = ANY($1::text[]) OR lower(room_id) = ANY($3::text[]))
            LIMIT 1`,
          [filtered, clean(userId), filtered.map((r) => r.toLowerCase())],
        );
        if (result.rowCount === 0) return false;
      } catch (err) {
        console.error("[RoomMute] isRoomMutedForUser failed:", err);
        return false;
      }
      return true;
    },

    async clearRoomMutesForUser(userId) {
      const targetUserId = clean(userId);
      if (!targetUserId) return 0;
      try {
        const result = await pool.query(`DELETE FROM room_mutes WHERE user_id = $1`, [targetUserId]);
        return result.rowCount || 0;
      } catch (err) {
        console.error("[RoomMute] clearRoomMutesForUser failed:", err);
        return 0;
      }
    },

    async clearRoomMute(roomIds, userId) {
      const filtered = Array.from(new Set(roomIds.map(clean).filter(Boolean)));
      const targetUserId = clean(userId);
      if (filtered.length === 0 || !targetUserId) return 0;
      try {
        const result = await pool.query(
          `DELETE FROM room_mutes
            WHERE user_id = $2 AND (room_id = ANY($1::text[]) OR lower(room_id) = ANY($3::text[]))`,
          [filtered, targetUserId, filtered.map((r) => r.toLowerCase())],
        );
        return result.rowCount || 0;
      } catch (err) {
        console.error("[RoomMute] clearRoomMute failed:", err);
        return 0;
      }
    },

    async getUserActiveRoomMutes(userId) {
      const targetUserId = clean(userId);
      if (!targetUserId) return [];
      try {
        const result = await pool.query(
          `SELECT room_id, expires_at FROM room_mutes
            WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
          [targetUserId],
        );
        return result.rows.map((row) => ({
          roomId: String(row.room_id || ""),
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        }));
      } catch (err) {
        console.error("[RoomMute] getUserActiveRoomMutes failed:", err);
        return [];
      }
    },
  };
}

/** الخدمة المشتركة لعملية التشغيل */
export const roomMuteService = createRoomMuteService();
