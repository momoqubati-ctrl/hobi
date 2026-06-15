export interface AnimatedFace {
  id: string;
  shortcut: string;
  name: string;
  image_url: string;
}

let cachedFaces: AnimatedFace[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

export async function fetchAnimatedFaces(): Promise<AnimatedFace[]> {
  const now = Date.now();
  if (cachedFaces && now - cacheTime < CACHE_TTL) return cachedFaces;

  try {
    const res = await fetch("/api/animated-faces");
    const data = await res.json();
    if (data.success && data.faces) {
      cachedFaces = data.faces;
      cacheTime = now;
      return data.faces;
    }
  } catch (e) {
    console.error("Failed to fetch animated faces:", e);
  }
  return cachedFaces || [];
}

export function findAnimatedFace(text: string, faces: AnimatedFace[]): AnimatedFace | null {
  const trimmed = text.trim();
  return faces.find((f) => f.shortcut === trimmed) || null;
}

export function clearAnimatedFaceCache() {
  cachedFaces = null;
  cacheTime = 0;
}
