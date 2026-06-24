import { dbPool } from "../db";

const CACHE_TTL_MS = 30_000;
let cachedShortcuts: { shortcut: string; replacement: string }[] | null = null;
let lastCacheTime = 0;

async function getShortcuts() {
  const now = Date.now();
  if (cachedShortcuts && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedShortcuts;
  }

  try {
    const result = await dbPool.query("SELECT shortcut, replacement FROM cuts ORDER BY id ASC");
    cachedShortcuts = result.rows.map((r: any) => ({
      shortcut: String(r.shortcut || "").trim(),
      replacement: String(r.replacement || ""),
    })).filter(s => s.shortcut);
    lastCacheTime = now;
    return cachedShortcuts;
  } catch (err) {
    console.error("Failed to fetch shortcuts:", err);
    return cachedShortcuts || [];
  }
}

export const clearShortcutCache = () => {
  cachedShortcuts = null;
};

export async function applyShortcuts(text: string): Promise<string> {
  if (!text) return text;
  const shortcuts = await getShortcuts();
  if (shortcuts.length === 0) return text;

  let result = text;
  for (const { shortcut, replacement } of shortcuts) {
    const regex = new RegExp(shortcut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    if (regex.test(result)) {
      result = result.replace(regex, replacement);
    }
  }
  return result;
}
