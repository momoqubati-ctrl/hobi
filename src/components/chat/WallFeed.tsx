"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Share2, MoreHorizontal, Image as ImageIcon, Search, X, Loader2, ArrowUp, Mic, MicOff, Pause, Play } from "lucide-react";
import EmojiPickerPopover, { EmojiPanel } from "./EmojiPickerPopover";
import WallComments from "./WallComments";
import { Input } from "@/components/ui/input";
import { YouTubeSearchInline, YTVideo } from "./YouTubeSearchInline";
import { YouTubePreviewCard, findYouTubeLinks } from "./YouTubePreviewCard";
import { Youtube } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { useRealtimeStore } from "@/lib/realtime-store";
import { useShallow } from "zustand/shallow";
import { optimisticCreatePost, optimisticToggleLike } from "@/lib/optimistic-actions";
import { useVoiceRecorder, formatDuration } from "@/lib/useVoiceRecorder";
import {
  playVideo,
  playAudio,
  pauseMedia,
  resumeMedia,
  seekMedia,
  getGlobalVideoState,
  subscribeToGlobalMedia,
  attachVideoTo,
  getGlobalVideoElement,
} from "@/lib/global-media";

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
};

const MediaRenderer = ({ url, className, style }: { url: string; className?: string; style?: React.CSSProperties }) => {
  const isAudio = url.match(/\.(mp3|webm|wav|ogg|m4a)/i) || url.includes("audio");
  const isVideo = url.match(/\.(mp4|webm|mov|avi)/i) || url.includes("video");

  if (isAudio) {
    return <audio src={url} className={className} style={style} controls />;
  }

  if (isVideo) {
    return <VideoRenderer url={url} className={className} style={style} />;
  }

  return <img src={url} alt="" className={className} style={style} />;
};

const VideoRenderer = ({ url, className, style }: { url: string; className?: string; style?: React.CSSProperties }) => {
  const [isActive, setIsActive] = useState(() => getGlobalVideoState().url === url);
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeToGlobalMedia(() => {
      const s = getGlobalVideoState();
      setIsActive(s.url === url);
    });
  }, [url]);

  // When active, attach the global video element to our slot
  useEffect(() => {
    if (!isActive || !slotRef.current) return;
    const video = getGlobalVideoElement();
    if (video) {
      attachVideoTo(slotRef.current);
    }
    // Re-try after a short delay in case DOM wasn't ready
    const t = setTimeout(() => {
      const v = getGlobalVideoElement();
      if (v && slotRef.current) {
        attachVideoTo(slotRef.current);
      }
    }, 100);
    return () => clearTimeout(t);
  }, [isActive]);

  const handleClick = () => {
    if (isActive) {
      pauseMedia();
    } else {
      playVideo(url);
    }
  };

  return (
    <div
      className={`relative cursor-pointer group ${isActive ? "" : "overflow-hidden"} ${className || ""}`}
      style={style}
      onClick={handleClick}
    >
      {/* Thumbnail video (paused, shows first frame) */}
      {!isActive && (
        <video
          src={url}
          className="w-full object-contain"
          style={{ maxHeight: 400 }}
          preload="metadata"
          muted
          playsInline
        />
      )}

      {/* Play button overlay (shown when not active) */}
      {!isActive && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-10 group-hover:bg-black/30 transition-colors">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play size={20} className="text-slate-800 ml-0.5" fill="currentColor" />
          </div>
        </div>
      )}

      {/* Wall slot for active video - actual video element attaches here */}
      {isActive && (
        <div
          ref={slotRef}
          className="w-full bg-black"
          style={{ aspectRatio: "16/9", minHeight: 200 }}
        />
      )}
    </div>
  );
};

const GlobalMediaPlayer = ({ url, type }: { url: string; type: "audio" | "video" }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isActive, setIsActive] = useState(() => getGlobalVideoState().url === url);
  const slotRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return subscribeToGlobalMedia(() => {
      const s = getGlobalVideoState();
      const isCurrent = s.url === url;
      setIsActive(isCurrent);
      setIsPlaying(isCurrent && s.isPlaying);
      if (isCurrent) {
        setCurrentTime(s.currentTime);
        setDuration(s.duration);
      }
    });
  }, [url]);

  // When active, attach the global video element to our slot
  useEffect(() => {
    if (!isActive || !slotRef.current || type !== "video") return;
    const video = getGlobalVideoElement();
    if (video) {
      attachVideoTo(slotRef.current);
    }
    const t = setTimeout(() => {
      const v = getGlobalVideoElement();
      if (v && slotRef.current) {
        attachVideoTo(slotRef.current);
      }
    }, 100);
    return () => clearTimeout(t);
  }, [isActive, type]);

  const togglePlay = () => {
    const s = getGlobalVideoState();
    if (s.url === url && s.isPlaying) {
      pauseMedia();
    } else {
      if (type === "video") {
        playVideo(url);
      } else {
        playAudio(url);
      }
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekMedia(parseFloat(e.target.value));
  };

  const onEnded = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const controls = (
    <>
      <button onClick={togglePlay} className="p-1.5 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors">
        {isPlaying ? <Pause size={16} className="text-primary" /> : <Play size={16} className="text-primary" />}
      </button>
      <span className="text-[9px] text-muted-foreground font-mono min-w-[35px]">
        {formatDuration(Math.floor(currentTime))}
      </span>
      <input
        type="range"
        min="0"
        max={duration || 0}
        value={currentTime}
        onChange={seek}
        className="flex-1 h-1 accent-primary cursor-pointer"
      />
      <span className="text-[9px] text-muted-foreground font-mono min-w-[35px]">
        {formatDuration(Math.floor(duration))}
      </span>
    </>
  );

  if (type === "video") {
    return (
      <div className="relative">
        <div
          ref={slotRef}
          className="w-full bg-black rounded-lg"
          style={{ aspectRatio: "16/9", minHeight: 200 }}
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 rounded-b-lg">
          <div className="flex items-center gap-2">
            {controls}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
      <audio
        src={url}
        onLoadedMetadata={() => {
          const s = getGlobalVideoState();
          if (s.url === url) setDuration(s.duration);
        }}
        onEnded={onEnded}
        preload="metadata"
        className="hidden"
      />
      {controls}
    </div>
  );
};

const MediaGrid = ({ urls }: { urls: string[] }) => {
  if (urls.length === 1) {
    return (
      <div className="grid gap-1.5 grid-cols-1">
        <div className="relative rounded-lg overflow-hidden border border-border/30 bg-black/5 inline-block max-w-full">
          <MediaRenderer url={urls[0]} className="w-full object-contain" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5 grid-cols-2">
      {urls.slice(0, 4).map((url, i) => (
        <div key={i} className="relative rounded-lg overflow-hidden border border-border/30 bg-black/5 aspect-square">
          <MediaRenderer url={url} className="w-full h-full object-contain" />
          {i === 3 && urls.length > 4 && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
              <span className="text-white text-lg font-black">+{urls.length - 4}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

interface MediaItem {
  file: File;
  preview: string;
  type: "image" | "video";
}

const PostComposer = React.memo(({ currentUser, onPost }: { currentUser: any; onPost: (text: string, mediaUrls?: string[]) => Promise<void> }) => {
  const [text, setText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [emojiCategory, setEmojiCategory] = useState("smileys");
  const [selectedVideo, setSelectedVideo] = useState<YTVideo | null>(null);
  const [showYouTubeSearch, setShowYouTubeSearch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newItems: MediaItem[] = [];
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      if (!isImage && !isVideo) continue;

      if (isImage) {
        try {
          const { compressImage, COMPRESS_PRESETS } = await import("@/lib/image-compress");
          const result = await compressImage(file, COMPRESS_PRESETS.wallPost);
          newItems.push({ file: result.file, preview: URL.createObjectURL(result.file), type: "image" });
          continue;
        } catch {}
      }

      newItems.push({ file, preview: URL.createObjectURL(file), type: "video" });
    }

    setMediaItems(prev => [...prev, ...newItems].slice(0, 10));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeMedia = (index: number) => {
    setMediaItems(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadFile = (file: File, token: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const ext = file.name.split(".").pop() || "jpg";

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/wall/upload");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percent);
          }
        };

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success) resolve(data.url);
            else reject(new Error(data.message || "فشل رفع الملف"));
          } catch {
            reject(new Error("فشل رفع الملف"));
          }
        };

        xhr.onerror = () => reject(new Error("خطأ في الاتصال"));
        xhr.send(JSON.stringify({ file: base64, filename: `wall.${ext}`, contentType: file.type }));
      };
      reader.onerror = () => reject(new Error("فشل قراءة الملف"));
      reader.readAsDataURL(file);
    });
  };

  const uploadAllMedia = async (): Promise<string[]> => {
    if (mediaItems.length === 0) return [];
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const token = localStorage.getItem("authToken");
      if (!token) throw new Error("جلسة غير صالحة");

      const urls: string[] = [];
      for (let i = 0; i < mediaItems.length; i++) {
        setUploadProgress(0);
        const url = await uploadFile(mediaItems[i].file, token);
        urls.push(url);
      }
      return urls;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const uploadVoiceRecording = async (): Promise<string | undefined> => {
    if (!recorder.audioBlob) return undefined;
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const token = localStorage.getItem("authToken");
      if (!token) throw new Error("جلسة غير صالحة");

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("فشل قراءة الملف"));
        reader.readAsDataURL(recorder.audioBlob!);
      });

      const ext = recorder.audioBlob!.type.includes("webm") ? "webm" : "mp3";
      const res = await fetch("/api/wall/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: base64, filename: `voice.${ext}`, contentType: recorder.audioBlob!.type }),
      });
      const data = await res.json();
      if (data.success) return data.url;
      throw new Error(data.message || "فشل رفع التسجيل");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSubmit = async () => {
    if ((!text.trim() && mediaItems.length === 0 && !recorder.audioBlob && !selectedVideo) || isPosting) return;
    setIsPosting(true);
    let content = text;
    if (selectedVideo) {
      const videoUrl = `https://www.youtube.com/watch?v=${selectedVideo.id}`;
      content = content ? `${content}\n${videoUrl}` : videoUrl;
    }
    const savedItems = [...mediaItems];
    const savedBlob = recorder.audioBlob;
    const savedUrl = recorder.audioUrl;
    setText("");
    setMediaItems([]);
    setSelectedVideo(null);
    setShowYouTubeSearch(false);
    try {
      const allUrls: string[] = [];

      // رفع الصور/الفيديو
      if (mediaItems.length > 0) {
        const urls = await uploadAllMedia();
        allUrls.push(...urls);
      }

      // رفع التسجيل الصوتي
      if (savedBlob) {
        const voiceUrl = await uploadVoiceRecording();
        if (voiceUrl) allUrls.push(voiceUrl);
        recorder.clearRecording();
      }

      await onPost(content, allUrls.length > 0 ? allUrls : undefined);
    } catch {
      setText(content);
      setMediaItems(savedItems);
    } finally {
      setIsPosting(false);
    }
  };

  if (!currentUser) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 bg-card shadow-sm">
      {/* لوحة الإيموجي - تنزلق من الأسفل */}
      <EmojiPanel
        onEmojiSelect={(emoji) => {
          setText((prev) => prev + emoji);
        }}
        search={emojiSearch}
        setSearch={setEmojiSearch}
        activeCategory={emojiCategory}
        setActiveCategory={setEmojiCategory}
        isOpen={emojiOpen}
      />

      <div className="p-3">
        <div className="flex gap-2 mb-3">
          <Avatar className="w-9 h-9 rounded-lg">
            <AvatarImage src={currentUser.avatar || "/pic.png"} />
            <AvatarFallback>{currentUser.name?.[0]}</AvatarFallback>
          </Avatar>
          <Input
            placeholder="بماذا تفكر؟"
            className="flex-1 bg-slate-100 border-none h-9 text-[11px] font-medium"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit()}
            dir="rtl"
          />
        </div>

        {/* معاينة الفيديو المختار من يوتيوب */}
        {selectedVideo && (
          <div className="mb-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border flex items-center gap-2 relative">
            <div className="relative shrink-0 w-16 h-10 rounded-md overflow-hidden bg-slate-200">
              <img src={selectedVideo.thumbnail} className="w-full h-full object-cover" alt="" />
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                <Youtube size={12} className="text-red-500" />
              </div>
            </div>
            <div className="flex-1 min-w-0 text-right" dir="rtl">
              <p className="text-[9px] font-bold text-red-600">فيديو YouTube المختار</p>
              <p className="text-[10px] text-foreground truncate" dir="auto">{selectedVideo.title}</p>
            </div>
            <button
              onClick={() => setSelectedVideo(null)}
              className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition shadow"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* لوحة البحث في يوتيوب */}
        {showYouTubeSearch && (
          <div className="mb-2 p-3 rounded-lg border border-border bg-slate-50 dark:bg-slate-900/40 animate-in slide-in-from-bottom duration-250">
            <YouTubeSearchInline
              onSelectVideo={(video) => setSelectedVideo(video)}
              selectedVideoId={selectedVideo?.id}
            />
          </div>
        )}

        {/* معاينة الوسائط */}
        {mediaItems.length > 0 && (
          <div className={`grid gap-1.5 mb-2 ${mediaItems.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {mediaItems.map((item, index) => (
              <div key={index} className="relative rounded-lg overflow-hidden border">
                {item.type === "video" ? (
                  <video src={item.preview} className="w-full h-32 object-cover" controls />
                ) : (
                  <img src={item.preview} alt="" className="w-full h-32 object-cover" />
                )}
                <button
                  onClick={() => removeMedia(index)}
                  className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5 hover:bg-black/70"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* تسجيل صوتي */}
        {recorder.isRecording && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-red-50 rounded-lg border border-red-200">
            <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-red-600">{formatDuration(recorder.duration)}</span>
            <div className="flex-1" />
            {recorder.isPaused ? (
              <button onClick={recorder.resumeRecording} className="p-1 rounded hover:bg-red-100">
                <Play size={14} className="text-red-600" />
              </button>
            ) : (
              <button onClick={recorder.pauseRecording} className="p-1 rounded hover:bg-red-100">
                <Pause size={14} className="text-red-600" />
              </button>
            )}
            <button onClick={recorder.stopRecording} className="p-1 rounded hover:bg-red-100">
              <MicOff size={14} className="text-red-600" />
            </button>
          </div>
        )}

        {/* معاينة التسجيل الصوتي */}
        {recorder.audioUrl && !recorder.isRecording && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-slate-50 rounded-lg border">
            <Mic size={14} className="text-primary" />
            <audio src={recorder.audioUrl} controls className="flex-1 h-8" />
            <button onClick={recorder.clearRecording} className="p-1 rounded hover:bg-slate-200">
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
        )}

        {recorder.error && (
          <p className="text-[9px] text-red-500 mb-1">{recorder.error}</p>
        )}

        {/* شريط التقدم */}
        {isUploading && (
          <div className="mb-2">
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: uploadProgress > 0 ? `${uploadProgress}%` : "30%" }}
              />
            </div>
            <p className="text-[9px] text-muted-foreground mt-0.5 text-center">
              {uploadProgress > 0 ? `جاري الرفع... ${uploadProgress}%` : "جاري الرفع..."}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-2">
          <div className="flex gap-1 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground gap-1.5 rounded-lg hover:bg-slate-100"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPosting || isUploading || recorder.isRecording}
            >
              <ImageIcon size={16} className="text-green-500" />
              <span className="text-[10px] font-bold">
                {mediaItems.length > 0 ? `${mediaItems.length} صور/فيديو` : "صورة/فيديو"}
              </span>
            </Button>

            {/* زر الإيموجي - مدمج في شريط الأدوات */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 px-2 gap-1.5 rounded-lg transition-colors ${
                emojiOpen
                  ? "bg-yellow-100 text-yellow-600 hover:bg-yellow-200"
                  : "text-muted-foreground hover:bg-slate-100 hover:text-yellow-500"
              }`}
              onClick={() => {
                setEmojiOpen((v) => !v);
                setShowYouTubeSearch(false);
              }}
              title="إيموجي"
            >
              <span className="text-base leading-none">{emojiOpen ? "🙂" : "😊"}</span>
              <span className="text-[10px] font-bold">إيموجي</span>
            </Button>

            {/* زر يوتيوب */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 px-2 gap-1.5 rounded-lg transition-colors ${
                showYouTubeSearch
                  ? "bg-red-100 text-red-600 hover:bg-red-200"
                  : "text-muted-foreground hover:bg-slate-100 hover:text-red-500"
              }`}
              onClick={() => {
                setShowYouTubeSearch(!showYouTubeSearch);
                setEmojiOpen(false);
              }}
              title="يوتيوب"
            >
              <Youtube size={16} className="text-red-500" />
              <span className="text-[10px] font-bold">يوتيوب</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-2 gap-1.5 rounded-lg ${recorder.isRecording ? "bg-red-100 text-red-600" : "text-muted-foreground hover:bg-slate-100"}`}
              onClick={recorder.isRecording ? recorder.stopRecording : recorder.startRecording}
              disabled={isPosting || isUploading}
            >
              {recorder.isRecording ? <MicOff size={16} /> : <Mic size={16} className="text-red-500" />}
              <span className="text-[10px] font-bold">
                {recorder.isRecording ? formatDuration(recorder.duration) : "صوت"}
              </span>
            </Button>
          </div>
          <Button
            size="sm"
            className="h-8 rounded-lg px-4 text-[10px] font-bold"
            onClick={handleSubmit}
            disabled={isPosting || isUploading || (!text.trim() && mediaItems.length === 0 && !recorder.audioBlob && !selectedVideo)}
          >
            {isPosting || isUploading ? <Loader2 className="animate-spin" size={14} /> : "نشر"}
          </Button>
        </div>
      </div>
    </div>
  );

});

const WallFeed = ({ onOpenProfile }: { onOpenProfile?: (userIdOrName: string) => void }) => {
  const {
    wallPosts: posts,
    isLoadingWallPosts: loading,
    isWallLoaded,
    setWallPosts,
    setLoadingWallPosts,
    wallLikedPosts,
    wallLikeCounts,
    wallCommentCounts,
  } = useRealtimeStore(useShallow((s: any) => ({
    wallPosts: s.wallPosts,
    isLoadingWallPosts: s.isLoadingWallPosts,
    isWallLoaded: s.isWallLoaded,
    setWallPosts: s.setWallPosts,
    setLoadingWallPosts: s.setLoadingWallPosts,
    wallLikedPosts: s.wallLikedPosts,
    wallLikeCounts: s.wallLikeCounts,
    wallCommentCounts: s.wallCommentCounts,
  })));

  const [searchQuery, setSearchQuery] = useState("");
  const [currentUser, setCurrentUser] = useState<any>(() => getStoredUser());
  const [openCommentPosts, setOpenCommentPosts] = useState<Record<string, boolean>>({});
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevPostsLengthRef = useRef(posts.length);
  const [activeYouTubeEmbedUrl, setActiveYouTubeEmbedUrl] = useState<string | null>(null);

  const fetchPosts = async (force = false) => {
    if (isWallLoaded && !force) return;
    try {
      setLoadingWallPosts(true);
      const url = currentUser ? `/api/wall/posts?userId=${currentUser.id}` : "/api/wall/posts";
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setWallPosts(data.posts);
      }
    } catch (err) {
      console.error("Failed to fetch posts", err);
    } finally {
      setLoadingWallPosts(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [isWallLoaded]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "user") setCurrentUser(getStoredUser());
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const handleToggleLike = async (postId: string) => {
    if (!currentUser) return;
    try {
      await optimisticToggleLike(postId);
    } catch (err: any) {
      showError(err.message || "فشل تحديث الإعجاب");
    }
  };

  const toggleComments = (postId: string) => {
    setOpenCommentPosts(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  // تتبع موضع التمرير
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrolled = el.scrollTop > 100;
    setIsScrolledDown(scrolled);
    // إذا وصلت منشورات جديدةwhile المستخدم في الأسفل
    if (scrolled && posts.length > prevPostsLengthRef.current) {
      setNewPostsCount(prev => prev + (posts.length - prevPostsLengthRef.current));
    }
    prevPostsLengthRef.current = posts.length;
  }, [posts.length]);

  // عند تغير المنشورات (من البث المباشر)
  useEffect(() => {
    const el = scrollRef.current;
    const scrolled = el ? el.scrollTop > 100 : false;
    if (scrolled && posts.length > prevPostsLengthRef.current) {
      setNewPostsCount(prev => prev + (posts.length - prevPostsLengthRef.current));
    }
    prevPostsLengthRef.current = posts.length;
  }, [posts.length]);

  // التمرير للأعلى ومسح العداد
  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewPostsCount(0);
  };

  const handlePost = async (content: string, mediaUrls?: string[]) => {
    await optimisticCreatePost(content, currentUser, mediaUrls);
    showSuccess("تم النشر بنجاح");
  };

  const filteredPosts = useMemo(() => posts.filter(post =>
    post.body?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.author?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  ), [posts, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-muted ltr">
      {/* شريط البحث العلوي */}
      <div className="p-1.5 bg-[#2c3e50] flex items-center gap-1.5 shrink-0">
        <div className="flex-1 relative">
          <Search size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50" />
          <Input
            placeholder="Search wall .."
            className="h-7 bg-card/10 border-none text-white placeholder:text-white/50 pr-7 rounded-md text-[10px]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* مشغل يوتيوب المدمج */}
      {activeYouTubeEmbedUrl && (
        <div className="relative w-full bg-black border-b border-slate-800 shadow-xl shrink-0 animate-in slide-in-from-top duration-300">
          <div className="relative w-full" style={{ aspectRatio: "16/9", maxHeight: "240px", margin: "0 auto" }}>
            <iframe
              src={`${activeYouTubeEmbedUrl}?autoplay=1&rel=0`}
              className="w-full h-full"
              allow="autoplay; fullscreen; encrypted-media"
              allowFullScreen
              title="YouTube Player"
            />
            <button
              onClick={() => setActiveYouTubeEmbedUrl(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center transition shadow-lg z-40"
              title="إغلاق المشغل"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* منطقة التمرير */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2 space-y-3 relative">
        {newPostsCount > 0 && (
          <button
            onClick={scrollToTop}
            className="sticky top-0 z-10 mx-auto flex items-center justify-center gap-1.5 w-full py-2 bg-primary text-white text-[11px] font-bold rounded-xl shadow-lg hover:bg-primary/90 transition-all animate-bounce"
          >
            <ArrowUp size={14} />
            منشورات جديدة ({newPostsCount})
          </button>
        )}

        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="animate-spin text-primary" size={24} />
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground text-xs font-bold">لا توجد منشورات حالياً</div>
        ) : (
          filteredPosts.map((post) => {
            const isLiked = wallLikedPosts.has(String(post.id));
            const likeCount = wallLikeCounts[String(post.id)] ?? post.likeCount ?? 0;
            const commentCount = wallCommentCounts[String(post.id)] ?? post.commentCount ?? 0;

            return (
              <Card key={post.id} className={`border-none shadow-sm rounded-xl overflow-hidden ${post.isOptimistic ? "opacity-70" : ""}`}>
                <CardHeader className="p-3 flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-2">
                    <Avatar
                      className="w-9 h-9 rounded-lg border border-border cursor-pointer transition hover:scale-105"
                      onClick={() => onOpenProfile?.(post.author?.id || post.author?.name)}
                    >
                      <AvatarImage src={post.author?.avatar || "/pic.png"} />
                      <AvatarFallback>{post.author?.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div dir="rtl">
                      <h4
                        className="font-black text-[11px] text-foreground cursor-pointer hover:underline"
                        onClick={() => onOpenProfile?.(post.author?.id || post.author?.name)}
                      >
                        {post.author?.name}
                      </h4>
                      <p className="text-[9px] text-muted-foreground font-bold">
                        {new Date(post.createdAt).toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                    <MoreHorizontal size={16} />
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="px-3 pb-2 text-[11px] text-foreground leading-relaxed font-medium" dir="rtl">
                    {post.body}
                  </div>
                  {post.body && findYouTubeLinks(post.body).map((link) => (
                    <div className="px-3 pb-2" key={link}>
                      <YouTubePreviewCard
                        url={link}
                        onPlay={(embedUrl) => setActiveYouTubeEmbedUrl(embedUrl)}
                      />
                    </div>
                  ))}
                  {(post.mediaUrls && post.mediaUrls.length > 0) || post.mediaUrl ? (
                    <MediaGrid urls={post.mediaUrls || (post.mediaUrl ? [post.mediaUrl] : [])} />
                  ) : null}
                  <div className="p-2 flex items-center justify-between border-t">
                    <div className="flex gap-3">
                      <button
                        className={`flex items-center gap-1 transition-colors ${
                          isLiked ? "text-red-500" : "text-muted-foreground hover:text-red-500"
                        }`}
                        onClick={() => handleToggleLike(post.id)}
                        disabled={post.isOptimistic}
                      >
                        <Heart size={16} className={isLiked ? "fill-red-500" : ""} />
                        <span className="text-[10px] font-bold">{likeCount}</span>
                      </button>
                      <button
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => toggleComments(post.id)}
                      >
                        <MessageCircle size={16} />
                        <span className="text-[10px] font-bold">{commentCount}</span>
                      </button>
                    </div>
                    <button className="text-muted-foreground hover:text-primary transition-colors">
                      <Share2 size={16} />
                    </button>
                  </div>
                  <WallComments
                    postId={post.id}
                    commentCount={commentCount}
                    currentUser={currentUser}
                    isOpen={openCommentPosts[post.id] || false}
                    onToggle={() => toggleComments(post.id)}
                    onOpenProfile={onOpenProfile}
                  />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {currentUser && (
        <div className="p-3 border-t bg-card shadow-lg z-20 shrink-0">
          <PostComposer currentUser={currentUser} onPost={handlePost} />
        </div>
      )}
    </div>
  );
};

export default WallFeed;
