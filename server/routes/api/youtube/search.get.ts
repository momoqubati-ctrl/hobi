import { defineEventHandler, getQuery, createError } from "h3";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const q = (query.q as string)?.trim();
  const maxResults = parseInt((query.maxResults as string) || "12", 10);
  const pageToken = (query.pageToken as string) || "";
  const type = (query.type as string) || "video";

  if (!q || q.length < 2) {
    throw createError({ statusCode: 400, message: "يجب أن يكون البحث حرفين على الأقل" });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw createError({ statusCode: 500, message: "YouTube API key غير مُهيأ" });
  }

  const params = new URLSearchParams({
    part: "snippet",
    q,
    key: apiKey,
    maxResults: String(Math.min(maxResults, 24)),
    type,
    relevanceLanguage: "ar",
    safeSearch: "moderate",
    ...(pageToken ? { pageToken } : {}),
  });

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as any)?.error?.message || `YouTube API error: ${res.status}`;
      throw createError({ statusCode: res.status, message: msg });
    }

    const data = await res.json() as any;

    const items = (data.items || []).map((item: any) => {
      const snippet = item.snippet || {};
      const id = item.id?.videoId || item.id?.channelId || item.id?.playlistId || "";
      const kind = item.id?.kind || "";
      return {
        id,
        kind,
        title: snippet.title || "",
        description: snippet.description || "",
        thumbnail:
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.default?.url ||
          "",
        channelTitle: snippet.channelTitle || "",
        publishedAt: snippet.publishedAt || "",
        videoUrl: kind === "youtube#video" ? `https://www.youtube.com/watch?v=${id}` : null,
        embedUrl: kind === "youtube#video" ? `https://www.youtube.com/embed/${id}` : null,
      };
    });

    return {
      success: true,
      items,
      nextPageToken: data.nextPageToken || null,
      prevPageToken: data.prevPageToken || null,
      totalResults: data.pageInfo?.totalResults || 0,
    };
  } catch (err: any) {
    if (err.statusCode) throw err;
    throw createError({ statusCode: 500, message: "فشل الاتصال بـ YouTube API" });
  }
});
