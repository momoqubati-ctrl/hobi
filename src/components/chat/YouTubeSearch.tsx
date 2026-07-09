"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Search, X, Loader2, Play, ExternalLink, ChevronRight, ChevronLeft,
  Youtube, Clock, User, Film, TrendingUp, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* ─── Types ──────────────────────────────────────────────────── */
interface YTVideo {
  id: string;
  kind: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  videoUrl: string | null;
  embedUrl: string | null;
}

interface SearchResult {
  items: YTVideo[];
  nextPageToken: string | null;
  prevPageToken: string | null;
  totalResults: number;
}

/* ─── Helpers ────────────────────────────────────────────────── */
const formatDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
};

const QUICK_SEARCHES = [
  "أخبار اليوم", "رياضة", "تعليم", "ترفيه", "تقنية", "موسيقى", "أفلام", "طبخ",
];

/* ─── VideoCard ──────────────────────────────────────────────── */
const VideoCard: React.FC<{
  video: YTVideo;
  onPlay: (video: YTVideo) => void;
}> = ({ video, onPlay }) => {
  return (
    <div
      className="group relative flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer"
      onClick={() => onPlay(video)}
    >
      {/* Thumbnail */}
      <div className="relative overflow-hidden bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: "16/9" }}>
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film size={32} className="text-slate-300" />
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-300 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-red-600 shadow-lg shadow-red-500/40 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300">
            <Play size={20} className="text-white ml-0.5" fill="currentColor" />
          </div>
        </div>

        {/* YouTube badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-md px-1.5 py-0.5">
          <Youtube size={10} className="text-red-500" />
          <span className="text-white text-[9px] font-bold">YouTube</span>
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 p-3 flex flex-col gap-1.5">
        <h3 className="text-[11px] font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-relaxed group-hover:text-primary transition-colors" dir="auto">
          {video.title}
        </h3>
        <div className="flex items-center gap-2 mt-auto">
          <div className="flex items-center gap-1 text-muted-foreground">
            <User size={9} />
            <span className="text-[9px] font-medium truncate max-w-[90px]">{video.channelTitle}</span>
          </div>
          {video.publishedAt && (
            <div className="flex items-center gap-1 text-muted-foreground mr-auto">
              <Clock size={9} />
              <span className="text-[9px]">{formatDate(video.publishedAt)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── VideoModal ─────────────────────────────────────────────── */
const VideoModal: React.FC<{
  video: YTVideo;
  onClose: () => void;
  isReel?: boolean;
}> = ({ video, onClose, isReel }) => {
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("iframe")) return;

    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const w = isReel ? (isMobile ? 180 : 250) : (isMobile ? 220 : 340);
      const h = isReel ? (w * 1.77) : (isMobile ? 180 : 250);
      const newX = Math.max(0, Math.min(window.innerWidth - w, e.clientX - dragStartRef.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - h, e.clientY - dragStartRef.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isMobile, isReel]);

  // Touch drag
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("iframe")) return;

    isDraggingRef.current = true;
    const touch = e.touches[0];
    dragStartRef.current = { x: touch.clientX - position.x, y: touch.clientY - position.y };
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDraggingRef.current) return;
    const touch = e.touches[0];
    const w = isReel ? (isMobile ? 180 : 250) : (isMobile ? 220 : 340);
    const h = isReel ? (w * 1.77) : (isMobile ? 180 : 250);
    const newX = Math.max(0, Math.min(window.innerWidth - w, touch.clientX - dragStartRef.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - h, touch.clientY - dragStartRef.current.y));
    setPosition({ x: newX, y: newY });
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
  };

  useEffect(() => {
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isMobile, isReel]);

  const width = isReel ? (isMobile ? 200 : 260) : (isMobile ? 240 : 360);
  const videoHeight = isReel ? (width * 1.77) : (width * 0.5625);

  return (
    <div
      className="fixed z-[9999] rounded-2xl overflow-hidden bg-slate-900/95 backdrop-blur border border-slate-700/50 shadow-2xl shadow-black/80 flex flex-col transition-all cursor-grab active:cursor-grabbing duration-75 select-none animate-in zoom-in-95 duration-100"
      style={{
        left: position.x,
        top: position.y,
        width: width,
        touchAction: "none",
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header bar for dragging */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/60 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Youtube size={12} className="text-red-500 shrink-0 animate-pulse" />
          <span className="text-[10px] font-black text-slate-200 truncate max-w-[120px] md:max-w-[180px]" dir="rtl">
            {video.title}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 rounded-full bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center transition-colors shrink-0"
        >
          <X size={10} />
        </button>
      </div>

      {/* Video Content */}
      <div 
        className="relative w-full bg-black select-none pointer-events-auto"
        style={{ height: videoHeight }}
      >
        {video.embedUrl ? (
          <iframe
            src={`${video.embedUrl}?autoplay=1&rel=0`}
            className="w-full h-full border-none"
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            title={video.title}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-3 text-center">
            <p className="text-[10px] text-slate-400 font-bold">لا يمكن تشغيل هذا الفيديو مباشرة</p>
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="px-3 py-1.5 bg-slate-950/40 border-t border-slate-800/50 flex items-center justify-between shrink-0">
        <span className="text-[8px] font-bold text-slate-400 truncate max-w-[100px]">{video.channelTitle}</span>
        {video.videoUrl && (
          <a
            href={video.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[8px] font-black text-red-400 hover:text-red-300 transition-colors"
          >
            <ExternalLink size={9} />
            فتح في YouTube
          </a>
        )}
      </div>
    </div>
  );
};

/* ─── ReelCard ───────────────────────────────────────────────── */
const ReelCard: React.FC<{
  video: YTVideo;
  onPlay: (video: YTVideo) => void;
}> = ({ video, onPlay }) => {
  return (
    <div
      className="group relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800/80 hover:border-red-500/50 shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer aspect-[9/16] flex flex-col justify-end p-2.5"
      onClick={() => onPlay(video)}
    >
      {/* Thumbnail */}
      <div className="absolute inset-0 bg-slate-950 overflow-hidden">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film size={20} className="text-slate-700" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-black/10" />
      </div>

      {/* Play overlay button */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-10 h-10 rounded-full bg-red-600 shadow shadow-red-500/40 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300">
          <Play size={14} className="text-white ml-0.5" fill="currentColor" />
        </div>
      </div>

      {/* YouTube badge */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded px-1 py-0.5 z-10 border border-white/5">
        <Youtube size={8} className="text-red-500" />
        <span className="text-white text-[7px] font-black tracking-wider">REEL</span>
      </div>

      {/* Info Overlay (At the bottom) */}
      <div className="relative z-10 flex flex-col gap-1 text-right" dir="rtl">
        <h3 className="text-[9px] font-bold text-slate-100 line-clamp-2 leading-snug group-hover:text-red-400 transition-colors" dir="auto">
          {video.title}
        </h3>
        <div className="flex items-center gap-1 text-[7px] text-slate-400 justify-end" dir="rtl">
          <User size={8} className="text-red-500 shrink-0" />
          <span className="truncate max-w-[80px]">{video.channelTitle}</span>
        </div>
      </div>
    </div>
  );
};

/* ─── Main YouTubeSearch Component ───────────────────────────── */
const YouTubeSearch: React.FC = () => {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeVideo, setActiveVideo] = useState<YTVideo | null>(null);
  const [pageStack, setPageStack] = useState<string[]>([""]);
  const [currentPage, setCurrentPage] = useState(0);
  const [subTab, setSubTab] = useState<"videos" | "reels">("videos");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string, pageToken = "", isReelsSearch = false) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      let finalQuery = q.trim();
      if (isReelsSearch && !finalQuery.toLowerCase().includes("shorts")) {
        finalQuery = `${finalQuery} #shorts`;
      }

      const params = new URLSearchParams({ q: finalQuery, maxResults: "12" });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(`/api/youtube/search?${params}`, {
        signal: abortRef.current.signal,
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "فشل البحث في YouTube");
        setResult(null);
        return;
      }

      setResult(data);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError("فشل الاتصال بالخادم");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setPageStack([""]);
    setCurrentPage(0);
    doSearch(query, "", subTab === "reels");
  };

  const handleQuickSearch = (term: string) => {
    setQuery(term);
    setPageStack([""]);
    setCurrentPage(0);
    doSearch(term, "", subTab === "reels");
  };

  const handleSubTabChange = (tab: "videos" | "reels") => {
    setSubTab(tab);
    setResult(null);
    setError(null);
    setPageStack([""]);
    setCurrentPage(0);

    if (query.trim()) {
      doSearch(query, "", tab === "reels");
    }
  };
  const handleNextPage = () => {
    if (!result?.nextPageToken) return;
    const newStack = [...pageStack.slice(0, currentPage + 1), result.nextPageToken];
    setPageStack(newStack);
    setCurrentPage(currentPage + 1);
    doSearch(query, result.nextPageToken, subTab === "reels");
  };

  const handlePrevPage = () => {
    if (currentPage <= 0) return;
    const newPage = currentPage - 1;
    setCurrentPage(newPage);
    doSearch(query, pageStack[newPage], subTab === "reels");
  };

  const handleClear = () => {
    setQuery("");
    setResult(null);
    setError(null);
    setPageStack([""]);
    setCurrentPage(0);
    inputRef.current?.focus();
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 rtl">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
        {/* Title & SubTabs */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-red-600 flex items-center justify-center shadow-md shadow-red-500/30 shrink-0">
              <Youtube size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-black text-slate-800 dark:text-white truncate">بحث YouTube</h2>
              <p className="text-[8px] text-muted-foreground font-bold tracking-tight">ابحث عن الفيديوهات والريلز</p>
            </div>
          </div>

          {/* Sub Tabs */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/85 p-0.5 rounded-xl border border-slate-200/20 shadow-inner shrink-0">
            <button
              onClick={() => handleSubTabChange("videos")}
              className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${
                subTab === "videos"
                  ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-white"
              }`}
            >
              فيديوهات
            </button>
            <button
              onClick={() => handleSubTabChange("reels")}
              className={`px-3 py-1 rounded-lg text-[9px] font-black transition-all ${
                subTab === "reels"
                  ? "bg-red-600 text-white shadow-md shadow-red-500/10"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-white"
              }`}
            >
              ريلز
            </button>
          </div>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={subTab === "reels" ? "ابحث عن ريلز يوتيوب..." : "ابحث عن أي فيديو..."}
              className="pr-9 pl-9 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border-none text-xs font-bold focus-visible:ring-red-500/30"
              dir="rtl"
            />
            {query && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-800 dark:hover:text-white transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <Button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shrink-0 shadow-md shadow-red-500/20"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : "بحث"}
          </Button>
        </form>

        {/* Quick search tags */}
        {!result && !loading && (
          <div className="flex flex-wrap gap-1.5 mt-3 justify-start">
            {QUICK_SEARCHES.map((term) => (
              <button
                key={term}
                onClick={() => handleQuickSearch(term)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 text-slate-600 dark:text-slate-400 text-[10px] font-bold transition-all border border-transparent hover:border-red-200 dark:hover:border-red-800"
              >
                <TrendingUp size={9} />
                {term}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-4 border-red-100 dark:border-red-950" />
              <div className="absolute inset-0 rounded-full border-4 border-t-red-600 animate-spin" />
            </div>
            <p className="text-xs font-bold text-muted-foreground">جاري البحث...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
              <AlertCircle size={22} className="text-red-500" />
            </div>
            <p className="text-xs font-bold text-red-500">{error}</p>
            <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => handleSearch()}>
              إعادة المحاولة
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !result && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-6">
            <div className="w-16 h-16 rounded-3xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center shadow-inner">
              <Youtube size={32} className="text-red-500" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-700 dark:text-slate-200 mb-1">
                {subTab === "reels" ? "استكشف الريلز والقصص" : "ابحث عن أي فيديو"}
              </p>
              <p className="text-[10px] text-muted-foreground font-medium">
                {subTab === "reels" 
                  ? "أدخل كلمة بحث واضغط على البحث أو تصفح الريلز التفاعلية الشائعة"
                  : "أدخل كلمة بحث واضغط على البحث أو اختر من الموضوعات السريعة"
                }
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && !error && result && (
          <div className="p-3">
            {/* Results count + page info */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-muted-foreground font-bold">
                {result.totalResults.toLocaleString("ar-EG")} نتيجة
              </p>
              {(result.nextPageToken || currentPage > 0) && (
                <p className="text-[10px] text-muted-foreground">
                  صفحة {currentPage + 1}
                </p>
              )}
            </div>

            {/* No results */}
            {result.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                <Search size={28} className="text-slate-300" />
                <p className="text-xs font-bold text-slate-400">لا توجد نتائج</p>
                <p className="text-[10px] text-muted-foreground">جرّب كلمة بحث مختلفة</p>
              </div>
            ) : (
              <>
                {/* Grid */}
                {subTab === "reels" ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {result.items.map((video) => (
                      <ReelCard key={video.id} video={video} onPlay={setActiveVideo} />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {result.items.map((video) => (
                      <VideoCard key={video.id} video={video} onPlay={setActiveVideo} />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {(result.nextPageToken || currentPage > 0) && (
                  <div className="flex items-center justify-center gap-3 mt-4 pb-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrevPage}
                      disabled={currentPage <= 0 || loading}
                      className="rounded-xl h-9 px-4 text-xs font-bold gap-1.5 disabled:opacity-40"
                    >
                      <ChevronRight size={14} />
                      السابق
                    </Button>
                    <span className="text-[10px] font-bold text-muted-foreground px-2">
                      {currentPage + 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={!result.nextPageToken || loading}
                      className="rounded-xl h-9 px-4 text-xs font-bold gap-1.5 disabled:opacity-40"
                    >
                      التالي
                      <ChevronLeft size={14} />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Video modal */}
      {activeVideo && (
        <VideoModal video={activeVideo} onClose={() => setActiveVideo(null)} isReel={subTab === "reels"} />
      )}
    </div>
  );
};

export default YouTubeSearch;
