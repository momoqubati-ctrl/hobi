"use client";

import React, { useState, useEffect } from "react";
import { Youtube, Play, Loader2, User } from "lucide-react";

// Global cache for video details to avoid redundant API hits in a session
const ytCache: Record<string, { title: string; channelTitle: string; thumbnail: string }> = {};

interface YouTubePreviewCardProps {
  url: string;
  onPlay: (embedUrl: string) => void;
}

export const YouTubePreviewCard: React.FC<YouTubePreviewCardProps> = ({ url, onPlay }) => {
  const [video, setVideo] = useState<{
    id: string;
    title: string;
    channelTitle: string;
    thumbnail: string;
    embedUrl: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const videoId = React.useMemo(() => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  }, [url]);

  useEffect(() => {
    if (!videoId) return;

    const cacheKey = videoId;
    if (ytCache[cacheKey]) {
      setVideo({
        id: videoId,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
        ...ytCache[cacheKey],
      });
      return;
    }

    let active = true;
    const fetchMetadata = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/youtube/search?q=${videoId}`);
        const data = await res.json();
        if (active && data.success && data.items && data.items.length > 0) {
          const item = data.items[0];
          const videoData = {
            id: videoId,
            title: item.title,
            channelTitle: item.channelTitle,
            thumbnail: item.thumbnail,
            embedUrl: `https://www.youtube.com/embed/${videoId}`,
          };
          ytCache[cacheKey] = {
            title: item.title,
            channelTitle: item.channelTitle,
            thumbnail: item.thumbnail,
          };
          setVideo(videoData);
        }
      } catch (err) {
        console.error("Failed to fetch YouTube metadata", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchMetadata();
    return () => {
      active = false;
    };
  }, [videoId]);

  if (!videoId) return null;

  if (loading) {
    return (
      <div className="mt-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 flex items-center justify-center h-16 w-60">
        <Loader2 className="animate-spin text-red-500" size={16} />
      </div>
    );
  }

  if (!video) return null;

  return (
    <div
      className="mt-2 overflow-hidden rounded-2xl border border-slate-200/50 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/60 shadow-sm flex items-center justify-between gap-3 max-w-[280px] p-2 hover:bg-white dark:hover:bg-slate-900 hover:shadow transition cursor-pointer group"
      onClick={() => onPlay(video.embedUrl)}
    >
      {/* Video Details (Left) */}
      <div className="flex-1 min-w-0 text-right">
        <h5
          className="text-[10px] font-black text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug mb-1"
          dir="rtl"
        >
          {video.title}
        </h5>
        <div className="flex items-center gap-1 text-[8px] text-slate-400 dark:text-slate-500 justify-end" dir="rtl">
          <User size={8} />
          <span className="truncate">{video.channelTitle}</span>
        </div>
      </div>

      {/* Video Thumbnail with Play Button Overlay (Right) */}
      <div className="relative shrink-0 w-20 h-12 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
        <img src={video.thumbnail} className="w-full h-full object-cover" alt="" />
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center group-hover:bg-black/35 transition">
          <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/25">
            <Play size={11} className="text-white fill-white ml-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Link Parsers ────────────────────────────────────────────── */
export function findYouTubeLinks(text: string): string[] {
  if (!text) return [];
  const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11}))/g;
  const matches = [];
  let match;
  while ((match = youtubeRegex.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return matches;
}

export default YouTubePreviewCard;
