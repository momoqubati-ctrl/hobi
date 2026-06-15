export interface Sticker {
  id: string;
  name: string;
  image_url: string;
}

export interface StickerCategory {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  stickers: Sticker[];
}

let cachedCategories: StickerCategory[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 دقيقة

export async function fetchStickerCategories(): Promise<StickerCategory[]> {
  const now = Date.now();
  if (cachedCategories && now - cacheTime < CACHE_TTL) return cachedCategories;

  try {
    const res = await fetch("/api/stickers");
    const data = await res.json();
    if (data.success && data.categories) {
      cachedCategories = data.categories;
      cacheTime = now;
      return data.categories;
    }
  } catch (e) {
    console.error("Failed to fetch stickers:", e);
  }
  return cachedCategories || [];
}

export function clearStickerCache() {
  cachedCategories = null;
  cacheTime = 0;
}
