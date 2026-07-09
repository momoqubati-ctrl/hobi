import { dbPool } from "../db";

const ROOM_PREFIX_PATTERN = /^(room|social|channel|chat):/i;

export function normalizeRoomIdValue(input?: string | null): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  return raw.replace(ROOM_PREFIX_PATTERN, "").trim();
}

export async function resolveRoomIdVariants(input?: string | null): Promise<string[]> {
  const rawRoomId = String(input ?? "").trim();
  if (!rawRoomId) return [];

  const candidates = Array.from(new Set([
    rawRoomId,
    normalizeRoomIdValue(rawRoomId),
    rawRoomId.replace(/^room:/i, "").trim(),
    rawRoomId.replace(/^social:/i, "").trim(),
    rawRoomId.split(":").pop()?.trim(),
  ].filter(Boolean)));

  const variants = new Set<string>(candidates);

  try {
    if (candidates.length > 0) {
      const result = await dbPool.query(
        `SELECT CAST(id AS text) AS id, slug
         FROM rooms
         WHERE CAST(id AS text) = ANY($1::text[])
            OR slug = ANY($1::text[])
         LIMIT 20`,
        [candidates]
      );

      for (const row of result.rows) {
        if (row?.id) variants.add(String(row.id));
        if (row?.slug) variants.add(String(row.slug));
      }
    }
  } catch {
    // keep fallback values
  }

  return Array.from(variants).filter(Boolean);
}

export async function resolveRoomId(input?: string | null): Promise<string> {
  const raw = String(input ?? "").trim();
  const variants = await resolveRoomIdVariants(input);
  const normalizedRaw = normalizeRoomIdValue(raw);
  const canonical = variants.find((value) => {
    const normalizedValue = normalizeRoomIdValue(value);
    return Boolean(value) && normalizedValue && normalizedValue !== normalizedRaw;
  });
  return canonical || variants[0] || normalizedRaw || raw;
}
