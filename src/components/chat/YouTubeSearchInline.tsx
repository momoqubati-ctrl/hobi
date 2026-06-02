"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Search, X, Loader2, Youtube, TrendingUp, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* ─── Types ──────────────────────────────────────────────────── */
export interface YTVideo {
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

interface YouTubeSearchInlineProps {
  onSelectVideo: (video: YTVideo | null) => void;
  selectedVideoId?: string | null;
}

const QUICK_SEARCHES = [
  "أخبار اليوم", "رياضة", "شيلات", "أغاني", "تعليم", "كوميدي", "تقنية", "طبخ",
];

export const YouTubeSearchInline: React.FC<YouTubeSearchInlineProps> = ({
  onSelectVideo,
  selectedVideoId,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YTVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams({ q: q.trim(), maxResults: "12" });
      const res = await fetch(`/api/youtube/search?${params}`, {
        signal: abortRef.current.signal,
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || "فشل البحث في YouTube");
        setResults([]);
        return;
      }

      setResults(data.items || []);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError("فشل الاتصال بالخادم");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query);
  };

  const handleQuickSearch = (term: string) => {
    setQuery(term);
    doSearch(term);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setError(null);
    onSelectVideo(null);
    inputRef.current?.focus();
  };

  const toggleSelectVideo = (video: YTVideo) => {
    if (selectedVideoId === video.id) {
      onSelectVideo(null);
    } else {
      onSelectVideo(video);
    }
  };

  return (
    <div className="flex flex-col gap-2 bg-card rounded-xl overflow-hidden [direction:rtl]" dir="rtl">
      {/* Search Input Box */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث يوتيوب..."
            className="pr-9 pl-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border-none text-[11px] font-bold focus-visible:ring-red-500/30 text-right"
            dir="rtl"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <Button
          type="submit"
          disabled={loading || !query.trim()}
          size="sm"
          className="h-9 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-[11px] shrink-0 shadow-md shadow-red-500/10"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : "بحث"}
        </Button>
      </form>

      {/* Quick Search keywords */}
      {results.length === 0 && !loading && !error && (
        <div className="flex flex-wrap gap-1 mt-1 justify-start">
          {QUICK_SEARCHES.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => handleQuickSearch(term)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 text-slate-600 dark:text-slate-300 text-[10px] font-black transition-all border border-transparent hover:border-red-200 dark:hover:border-red-900"
            >
              <TrendingUp size={10} className="text-red-500" />
              {term}
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-6 gap-2">
          <Loader2 className="animate-spin text-red-500" size={16} />
          <span className="text-[10px] font-bold text-muted-foreground">جاري البحث في يوتيوب...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex items-center justify-center py-4 gap-2 text-red-500 text-[10px] font-bold">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Results grid */}
      {results.length > 0 && !loading && !error && (
        <div className="flex gap-2 overflow-x-auto py-1 px-0.5 no-scrollbar max-w-full">
          {results.map((video) => {
            const isSelected = selectedVideoId === video.id;
            return (
              <div
                key={video.id}
                onClick={() => toggleSelectVideo(video)}
                className={`relative shrink-0 w-28 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800/50 border transition-all cursor-pointer group select-none ${
                  isSelected
                    ? "border-red-500 ring-2 ring-red-500/20 shadow-md shadow-red-500/10 scale-95"
                    : "border-slate-100 dark:border-slate-700/50 hover:border-red-400"
                }`}
              >
                {/* Image & Selection Indicator */}
                <div className="relative aspect-video bg-slate-200 dark:bg-slate-900 overflow-hidden">
                  <img
                    src={video.thumbnail}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  {/* YouTube badge */}
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 bg-black/70 backdrop-blur-[2px] rounded px-1 py-0.5">
                    <Youtube size={8} className="text-red-500" />
                    <span className="text-white text-[7px] font-black">YouTube</span>
                  </div>

                  {/* Checked indicator */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-red-600/30 backdrop-blur-[1px] flex items-center justify-center animate-in zoom-in-75 duration-150">
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-lg">
                        <Check size={12} className="text-red-600 stroke-[3px]" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Video title */}
                <div className="p-1.5 flex flex-col gap-0.5">
                  <h4
                    className="text-[9px] font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug group-hover:text-red-600 dark:group-hover:text-red-500 text-right"
                    dir="auto"
                  >
                    {video.title}
                  </h4>
                  <span className="text-[7px] text-muted-foreground truncate text-right">
                    {video.channelTitle}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default YouTubeSearchInline;
