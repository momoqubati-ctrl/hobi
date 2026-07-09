"use client";

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Share2, MoreHorizontal, Image as ImageIcon, Search, X, Loader2, ArrowUp, Mic, MicOff, Pause, Play, Smile, SmilePlus } from "lucide-react";
import EmojiPickerPopover, { EmojiPanel } from "./EmojiPickerPopover";
import WallComments from "./WallComments";
import { Input } from "@/components/ui/input";
import { YouTubeSearchInline, YTVideo } from "./YouTubeSearchInline";
import { YouTubePreviewCard, findYouTubeLinks } from "./YouTubePreviewCard";
import { Youtube } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Plus } from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { useRealtimeStore } from "@/lib/realtime-store";
import { useShallow } from "zustand/shallow";
const showMuteAlert = (message: string) => {
  let detail: any = {
    alertId: String(Date.now()),
    fromUsername: "النظام",
    fromAvatar: "/pic.png",
    message,
    timestamp: Date.now()
  };
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const user = JSON.parse(raw);
      detail = {
        alertId: String(Date.now()),
        fromUsername: user.name || user.username || "النظام",
        fromAvatar: user.avatar || "/pic.png",
        fromBanner: user.giftedBannerUrl || "",
        fromGiftIcon: user.giftedGiftIconUrl || "",
        fromPromotionIcon: user.roleIconUrl || user.giftedPromotionIconUrl || "",
        fromAvatarFrame: user.avatarFrameUrl || "",
        message,
        timestamp: Date.now()
      };
    }
  } catch {}
  window.dispatchEvent(new CustomEvent("show-client-alert", { detail }));
};

import { optimisticCreatePost, optimisticToggleLike } from "@/lib/optimistic-actions";
import { useVoiceRecorder, formatDuration } from "@/lib/useVoiceRecorder";
import { fetchAnimatedFaces, AnimatedFace } from "@/lib/animatedFaceData";
import { fetchStickerCategories, StickerCategory } from "@/lib/stickerData";
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

const FACE_MARKER_RE = /\u200B\[\[FACE:(\d+)\]\]\u200B/g;

const renderTextWithFaces = (text: string, faceUrls?: string[] | null) => {
  if (!faceUrls || faceUrls.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FACE_MARKER_RE.lastIndex = 0;
  while ((match = FACE_MARKER_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const idx = parseInt(match[1], 10);
    if (faceUrls[idx]) {
      parts.push(
        <img
          key={`f${match.index}`}
          src={faceUrls[idx]}
          alt="فيس"
          className="inline-block align-middle object-contain"
          style={{ width: "40px", height: "40px" }}
        />
      );
    } else {
      parts.push(<span key={`m${match.index}`}>{match[0]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`end${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
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

  return <ConstrainedImage url={url} className={className} style={style} />;
};

const ConstrainedImage = ({ url, className, style }: { url: string; className?: string; style?: React.CSSProperties }) => {
  const [isSmall, setIsSmall] = useState(false);
  return (
    <img
      src={url}
      alt=""
      className={className}
      style={{ ...style, ...(isSmall ? { maxWidth: "150px", maxHeight: "150px", width: "auto", height: "auto" } : {}) }}
      onLoad={(e) => {
        const img = e.target as HTMLImageElement;
        if (img.naturalWidth <= 200 || img.naturalHeight <= 200) {
          setIsSmall(true);
        }
      }}
    />
  );
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

const PostComposer = React.memo(({ currentUser, onPost }: { currentUser: any; onPost: (text: string, mediaUrls?: string[], animatedFaces?: string[]) => Promise<void> }) => {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFaces, setShowFaces] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [stickerCategories, setStickerCategories] = useState<StickerCategory[]>([]);
  const [activeStickerCat, setActiveStickerCat] = useState<string | null>(null);
  const [animatedFaces, setAnimatedFaces] = useState<AnimatedFace[]>([]);

  useEffect(() => {
    fetchAnimatedFaces().then((f) => { if (f.length > 0) setAnimatedFaces(f); });
  }, []);

  useEffect(() => {
    if (!showStickers) return;
    let cancelled = false;
    fetchStickerCategories().then((cats) => {
      if (cancelled) return;
      setStickerCategories(cats);
      if (cats.length > 0 && !activeStickerCat) setActiveStickerCat(cats[0].id);
    });
    return () => { cancelled = true; };
  }, [showStickers, activeStickerCat]);

  const closeAllPanels = useCallback(() => {
    setEmojiOpen(false);
    setShowYouTubeSearch(false);
    setShowFaces(false);
    setShowStickers(false);
  }, []);

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
    if (useRealtimeStore.getState().isMuted) {
      showMuteAlert("تم منعك من الحديث في الدردشة (اسكات)");
      return;
    }
    if ((!text.trim() && mediaItems.length === 0 && !recorder.audioBlob && !selectedVideo) || isPosting) return;
    setIsPosting(true);
    let content = text;
    let faceUrls: string[] | undefined;
    if (selectedVideo) {
      const videoUrl = `https://www.youtube.com/watch?v=${selectedVideo.id}`;
      content = content ? `${content}\n${videoUrl}` : videoUrl;
    }
    // معالجة الفيسات المتحركة في النص
    if (animatedFaces.length > 0 && content) {
      const matchedUrls: string[] = [];
      let processedText = content;
      for (const face of animatedFaces) {
        const regex = new RegExp(face.shortcut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        if (regex.test(processedText)) {
          const faceIdx = matchedUrls.length;
          const matches = processedText.match(regex);
          if (matches) {
            for (let i = 0; i < matches.length; i++) {
              matchedUrls.push(face.image_url);
            }
          }
          let counter = 0;
          processedText = processedText.replace(regex, () => `\u200B[[FACE:${faceIdx + counter++}]]\u200B`);
        }
      }
      if (matchedUrls.length > 0) {
        content = processedText;
        faceUrls = matchedUrls;
      }
    }
    const savedItems = [...mediaItems];
    const savedBlob = recorder.audioBlob;
    const savedUrl = recorder.audioUrl;
    setText("");
    setMediaItems([]);
    setSelectedVideo(null);
    setShowYouTubeSearch(false);
    closeAllPanels();
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

      // فيسات متحركة تُرسل فقط كanimatedFaces (تظهر في النص وليس كشبكة)

      await onPost(content, allUrls.length > 0 ? allUrls : undefined, faceUrls && faceUrls.length > 0 ? faceUrls : undefined);
    } catch {
      setText(content);
      setMediaItems(savedItems);
    } finally {
      setIsPosting(false);
    }
  };

  const handleSendSticker = async (stickerUrl: string) => {
    if (useRealtimeStore.getState().isMuted) {
      showMuteAlert("تم منعك من الحديث في الدردشة (اسكات)");
      return;
    }
    closeAllPanels();
    const allUrls: string[] = [stickerUrl];
    let content = text.trim();
    if (selectedVideo) {
      const videoUrl = `https://www.youtube.com/watch?v=${selectedVideo.id}`;
      content = content ? `${content}\n${videoUrl}` : videoUrl;
    }
    setText("");
    setSelectedVideo(null);
    setIsPosting(true);
    try {
      await onPost(content || "", allUrls);
    } catch {
      setText(content);
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

      {/* لوحة الفيسات المتحركة */}
      {showFaces && (
        <div className="border-b border-border bg-card animate-in slide-in-from-bottom duration-200">
          <div className="p-2 text-[10px] text-muted-foreground font-bold">
            اكتب الاختصار في حقل الكتابة (مثال: ف1)
          </div>
          <div className="flex flex-wrap gap-2 p-3 max-h-[200px] overflow-y-auto">
            {animatedFaces.map((face) => (
              <button
                key={face.id}
                type="button"
                onClick={() => {
                  setText((prev) => prev + face.shortcut);
                  setShowFaces(false);
                }}
                className="flex flex-col items-center gap-1 shrink-0 rounded-xl hover:bg-muted transition active:scale-90 p-1"
              >
                <img src={face.image_url} alt={face.name} className="object-contain" style={{ width: "40px", height: "40px" }} />
                <span className="text-[10px] font-bold text-primary">{face.shortcut}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* لوحة الملصقات */}
      {showStickers && (
        <div className="border-b border-border bg-card animate-in slide-in-from-bottom duration-200">
          <div className="flex gap-1 px-3 pt-2 pb-1 overflow-x-auto">
            {stickerCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveStickerCat(cat.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
                  activeStickerCat === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <img src={cat.icon} className="w-5 h-5 rounded-md object-cover" alt="" />
                {cat.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 p-3 max-h-[250px] overflow-y-auto">
            {stickerCategories.find((c) => c.id === activeStickerCat)?.stickers.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSendSticker(s.image_url)}
                className="w-[120px] h-[120px] flex items-center justify-center rounded-xl hover:bg-muted transition active:scale-90 overflow-hidden shrink-0"
              >
                <img src={s.image_url} alt={s.name} className="w-full h-full object-contain" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-3">
        <div className="flex gap-2 mb-3">
          <Avatar className="w-11 h-11 rounded-lg">
            <AvatarImage src={currentUser?.avatar || "/pic.png"} />
            <AvatarFallback>{currentUser?.name?.[0]}</AvatarFallback>
          </Avatar>
          <Input
            placeholder="بماذا تفكر؟"
            className="flex-1 bg-slate-100 border-none h-9 text-xs font-medium"
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
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isPosting || isUploading || recorder.isRecording}
                  className={`h-8 w-8 rounded-lg transition-colors ${menuOpen || emojiOpen || showYouTubeSearch || showFaces || showStickers ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-slate-100 hover:text-primary"}`}
                  title="أدوات النشر"
                >
                  {(emojiOpen || showYouTubeSearch || showFaces || showStickers) ? <X size={16} /> : <Plus size={16} />}
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-auto p-2 mb-2 z-50">
                <div className="flex gap-1 flex-wrap justify-center">
                  <button type="button" onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted transition active:scale-90" title="إرفاق صورة أو فيديو">
                    <ImageIcon size={22} className="text-green-500" />
                    <span className="text-[9px] font-bold">صورة</span>
                  </button>
                  <button type="button" onClick={() => { setMenuOpen(false); closeAllPanels(); setShowStickers(true); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showStickers ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="ملصقات">
                    <span className="text-[20px] leading-none">🖼️</span>
                    <span className="text-[9px] font-bold">ملصقات</span>
                  </button>
                  <button type="button" onClick={() => { setMenuOpen(false); closeAllPanels(); setShowFaces(true); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showFaces ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="فيسات متحركة">
                    <Smile size={22} className="text-orange-500" />
                    <span className="text-[9px] font-bold">فيسات</span>
                  </button>
                  <button type="button" onClick={() => { setMenuOpen(false); setEmojiOpen((v) => !v); setShowYouTubeSearch(false); setShowFaces(false); setShowStickers(false); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${emojiOpen ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="إيموجي">
                    <SmilePlus size={22} className="text-yellow-500" />
                    <span className="text-[9px] font-bold">إيموجي</span>
                  </button>
                  <button type="button" onClick={() => { setMenuOpen(false); setShowYouTubeSearch(!showYouTubeSearch); setEmojiOpen(false); setShowFaces(false); setShowStickers(false); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showYouTubeSearch ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="يوتيوب">
                    <Youtube size={22} className="text-red-500" />
                    <span className="text-[9px] font-bold">يوتيوب</span>
                  </button>
                  <button type="button" onClick={() => { setMenuOpen(false); if (recorder.isRecording) { recorder.stopRecording(); } else { recorder.startRecording(); } }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${recorder.isRecording ? "bg-red-500 text-white" : "hover:bg-muted"}`} title={recorder.isRecording ? "إيقاف التسجيل" : "تسجيل صوتي"}>
                    {recorder.isRecording ? <MicOff size={22} /> : <Mic size={22} className="text-red-500" />}
                    <span className="text-[9px] font-bold">{recorder.isRecording ? formatDuration(recorder.duration) : "صوت"}</span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
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
    onlineUsers,
  } = useRealtimeStore(useShallow((s: any) => ({
    wallPosts: s.wallPosts,
    isLoadingWallPosts: s.isLoadingWallPosts,
    isWallLoaded: s.isWallLoaded,
    setWallPosts: s.setWallPosts,
    setLoadingWallPosts: s.setLoadingWallPosts,
    wallLikedPosts: s.wallLikedPosts,
    wallLikeCounts: s.wallLikeCounts,
    wallCommentCounts: s.wallCommentCounts,
    onlineUsers: s.onlineUsers,
  })));

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

  const handlePost = async (content: string, mediaUrls?: string[], animatedFaces?: string[]) => {
    await optimisticCreatePost(content, currentUser, mediaUrls, animatedFaces);
    showSuccess("تم النشر بنجاح");
  };

  return (
    <div className="flex flex-col h-full bg-muted ltr">
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
        ) : posts.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground text-xs font-bold">لا توجد منشورات حالياً</div>
        ) : (
          posts.map((post) => {
            const isLiked = wallLikedPosts.has(String(post.id));
            const likeCount = wallLikeCounts[String(post.id)] ?? post.likeCount ?? 0;
            const commentCount = wallCommentCounts[String(post.id)] ?? post.commentCount ?? 0;

            return (
              <Card key={post.id} className={`border-none shadow-sm rounded-xl overflow-hidden ${post.isOptimistic ? "opacity-70" : ""}`}>
                <CardHeader className="p-3 flex-row items-center justify-between space-y-0">
                  <div className="flex items-center gap-2">
                    <Avatar
                      className="w-11 h-11 rounded-lg border border-border cursor-pointer transition hover:scale-105"
                      onClick={() => onOpenProfile?.(post.author?.id || post.author?.name)}
                    >
                      <AvatarImage src={post.author?.avatar || "/pic.png"} />
                      <AvatarFallback>{post.author?.name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div dir="rtl">
                      <div className="flex items-center gap-1">
                        {(() => {
                          const authorId = post.author?.id;
                          if (!authorId) return null;
                          const u = onlineUsers.find(o => String(o.id) === String(authorId));
                          const banner = u?.giftedBannerUrl || (post.author as any)?.giftedBannerUrl || "";
                          const giftIcon = u?.giftedGiftIconUrl || (post.author as any)?.giftedGiftIconUrl || "";
                          const promoIcon = u?.roleIconUrl || u?.giftedPromotionIconUrl || (post.author as any)?.roleIconUrl || (post.author as any)?.giftedPromotionIconUrl || "";
                          return (
                            <>
                              {promoIcon && <img src={promoIcon} alt="" className="h-4 w-4 rounded object-contain" />}
                              {giftIcon && <img src={giftIcon} alt="" className="h-4 w-4 rounded object-contain" />}
                              {banner && <img src={banner} alt="" className="h-6 w-auto rounded object-contain max-w-[6.5rem]" />}
                            </>
                          );
                        })()}
                        <h4
                          className="font-black text-xs text-foreground cursor-pointer hover:underline"
                          onClick={() => onOpenProfile?.(post.author?.id || post.author?.name)}
                          style={(() => {
                            const authorId = post.author?.id;
                            if (!authorId) return undefined;
                            const u = onlineUsers.find(o => String(o.id) === String(authorId));
                            const resolvedColor = u?.nameColor || (post.author as any)?.nameColor || "";
                            return resolvedColor && resolvedColor !== "#000000" ? { color: resolvedColor } : undefined;
                          })()}
                        >
                          {post.author?.name}
                        </h4>
                      </div>
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
                  <div className="px-3 pb-2 text-xs text-foreground leading-relaxed font-medium break-words" dir="rtl"
  style={(() => {
    const authorId = post.author?.id;
    if (!authorId) return undefined;
    const u = onlineUsers.find(o => String(o.id) === String(authorId));
    const resolvedColor = u?.statusFontColor || (post.author as any)?.statusFontColor || "";
    return resolvedColor && resolvedColor !== "#000000" ? { color: resolvedColor } : undefined;
  })()}
>
  {renderTextWithFaces(post.body || "", post.animatedFaces)}
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
