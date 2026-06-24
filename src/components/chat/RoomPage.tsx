"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmojiPanel } from "./EmojiPickerPopover";
import { Gift, Send, Plus, X, Volume2, VolumeX, Crown, MicOff, ChevronLeft, Mic2, AudioLines, Loader2, SmilePlus, Reply, ArrowLeft, Youtube, ImagePlus, Video, Smile, LogOut, Menu } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { getCountryFlagSrc, normalizeCountryCode } from "@/lib/countries";
import { getSocket } from "@/lib/socket";
import { YouTubeSearchInline, YTVideo } from "./YouTubeSearchInline";
import { YouTubePreviewCard, findYouTubeLinks } from "./YouTubePreviewCard";
import VoiceMessagePlayer from "./VoiceMessagePlayer";
import { fetchStickerCategories, StickerCategory } from "@/lib/stickerData";
import { fetchAnimatedFaces, AnimatedFace, findAnimatedFace } from "@/lib/animatedFaceData";
import { useVoiceRecorder, formatDuration } from "@/lib/useVoiceRecorder";
import { NotificationsBell } from "./NotificationsPanel";

type ReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

const REACTIONS_CONFIG: { type: ReactionType; emoji: string; label: string }[] = [
  { type: "like",  emoji: "👍", label: "أعجبني" },
  { type: "love",  emoji: "❤️", label: "حب" },
  { type: "haha",  emoji: "😂", label: "ضحك" },
  { type: "wow",   emoji: "😮", label: "متفاجئ" },
  { type: "sad",   emoji: "😢", label: "حزين" },
  { type: "angry", emoji: "😡", label: "غاضب" },
];

type ChatMessage = {
  id: string;
  clientId?: string;
  user: string;
  userId?: string;
  role: "guest" | "member" | "admin" | "bot" | "system";
  text: string;
  avatar: string;
  countryCode?: string;
  avatarFrameUrl?: string;
  giftIconUrl?: string;
  messageBubbleStyle?: string;
  color: string;
  isOwner?: boolean;
  isSystem?: boolean;
  systemType?: "join" | "leave" | "transition";
  targetRoom?: {
    id: string;
    name: string;
    image: string;
  };
  reactions?: Record<string, ReactionType>;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  mediaType?: "image" | "video" | "audio";
  sticker?: string;
  animatedFaces?: string[];
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
};

type RoomMember = {
  id: string;
  username: string;
  role: string;
  avatar: string;
  countryCode: string;
  avatarFrameUrl?: string;
  giftIconUrl?: string;
};

const getStoredUser = () => {
  const fallback = {
    name: "زائر",
    id: "0",
    role: "guest" as const,
    countryCode: "SA",
    avatar: "/pic.png",
    profileMsg: "( غير مسجل )",
    avatarFrameUrl: "",
    giftIconUrl: "",
    profileThemeId: "",
    messageBubbleStyle: "default",
  };

  try {
    const raw = localStorage.getItem("user");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const role = parsed.role === "admin" ? ("admin" as const) : parsed.role === "guest" ? ("guest" as const) : ("member" as const);

    const resolvedStatusMsg = typeof parsed.statusMsg === "string" && parsed.statusMsg.trim()
      ? parsed.statusMsg.trim()
      : typeof parsed.profileMsg === "string" && parsed.profileMsg.trim()
        ? parsed.profileMsg.trim()
        : role === "guest"
          ? "( غير مسجل )"
          : "(عضو جديد)";

    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : fallback.name,
      id: String(parsed.id || parsed.idreg || parsed.uid || fallback.id),
      role,
      countryCode: normalizeCountryCode(parsed.countryCode),
      avatar: typeof parsed.avatar === "string" && parsed.avatar.trim() ? parsed.avatar : fallback.avatar,
      avatarFrameUrl: typeof parsed.avatarFrameUrl === "string" ? parsed.avatarFrameUrl : "",
      giftIconUrl:
        typeof parsed.giftIconUrl === "string" && parsed.giftIconUrl.trim()
          ? parsed.giftIconUrl
          : typeof parsed.giftIcon === "string"
            ? parsed.giftIcon
            : "",
      profileThemeId: typeof parsed.profileThemeId === "string" ? parsed.profileThemeId : "",
      messageBubbleStyle: typeof parsed.messageBubbleStyle === "string" ? parsed.messageBubbleStyle : "default",
      profileMsg: resolvedStatusMsg,
      statusMsg: resolvedStatusMsg,
    };
  } catch {
    return fallback;
  }
};

const formatMessageTime = (value: string) =>
  new Intl.DateTimeFormat("ar", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const getMessageBubbleClass = (msg: ChatMessage) => {
  if (msg.isSystem) {
    if (msg.systemType === "transition") {
      return "border-indigo-100/70 bg-indigo-50/50 dark:border-indigo-900/30 dark:bg-indigo-950/20 text-indigo-800 dark:text-indigo-400";
    }
    if (msg.systemType === "leave") {
      return "border-rose-100/70 bg-rose-50/50 dark:border-rose-900/30 dark:bg-rose-950/20 text-rose-800 dark:text-rose-400";
    }
    return "border-teal-100/70 bg-teal-50/50 dark:border-teal-900/30 dark:bg-teal-950/20 text-teal-800 dark:text-teal-400";
  }
  if (msg.failed) return "border-red-100 bg-red-50 text-red-700";
  if (msg.messageBubbleStyle === "soft") return "border-blue-100 bg-blue-50 text-foreground";
  if (msg.messageBubbleStyle === "dark") return "border-slate-800 bg-slate-900 text-white";
  return "border-border bg-card text-foreground";
};

const FACE_MARKER_RE = /\u200B\[\[FACE:(\d+)\]\]\u200B/g;

const renderTextWithFaces = (text: string, faceUrls?: string[]) => {
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
      parts.push(<img key={`f${match.index}`} src={faceUrls[idx]} alt="فيس متحرك" className="object-contain inline-block align-middle mx-0.5" style={{ width: "40px", height: "40px" }} />);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
};

const ChatInputArea = React.memo(({ roomId, onSendMessage, onSendMedia, onSendSticker, onSendAnimatedFace, replyToMsg, onCancelReply }: {
  roomId: string;
  onSendMessage: (text: string, animatedFaceUrls?: string[]) => void;
  onSendMedia?: (mediaUrl: string, mediaType: "image" | "video" | "audio", text?: string, mediaUrls?: string[]) => void;
  onSendSticker?: (stickerUrl: string) => void;
  onSendAnimatedFace?: (faceUrl: string) => void;
  replyToMsg: ChatMessage | null;
  onCancelReply: () => void;
}) => {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [activeEmojiCat, setActiveEmojiCat] = useState("animated");
  const [selectedVideo, setSelectedVideo] = useState<YTVideo | null>(null);
  const [showYouTubeSearch, setShowYouTubeSearch] = useState(false);
  const typingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const recorder = useVoiceRecorder();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview: string; type: "image" | "video" }[]>([]);
  const [showStickers, setShowStickers] = useState(false);
  const [stickerCategories, setStickerCategories] = useState<StickerCategory[]>([]);
  const [activeStickerCat, setActiveStickerCat] = useState<string>("");
  const [showFaces, setShowFaces] = useState(false);
  const [animatedFaces, setAnimatedFaces] = useState<AnimatedFace[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputAreaRef = useRef<HTMLDivElement>(null);

  const closeAllPanels = useCallback(() => {
    setShowStickers(false);
    setShowFaces(false);
    setShowEmoji(false);
    setShowYouTubeSearch(false);
  }, []);

  useEffect(() => {
    if (!showStickers && !showFaces && !showEmoji && !showYouTubeSearch) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (inputAreaRef.current && !inputAreaRef.current.contains(e.target as Node)) {
        closeAllPanels();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showStickers, showFaces, showEmoji, showYouTubeSearch, closeAllPanels]);

  useEffect(() => {
    if (showStickers && stickerCategories.length === 0) {
      fetchStickerCategories().then((cats) => {
        setStickerCategories(cats);
        if (cats.length > 0 && !activeStickerCat) setActiveStickerCat(cats[0].id);
      });
    }
  }, [showStickers]);

  useEffect(() => {
    if (animatedFaces.length === 0) {
      fetchAnimatedFaces().then(setAnimatedFaces);
    }
  }, []);

  const handleSendSticker = (imageUrl: string) => {
    onSendSticker?.(imageUrl);
    setShowStickers(false);
  };

  const uploadFile = async (file: File): Promise<{ url: string; type: "image" | "video" } | null> => {
    try {
      const token = localStorage.getItem("authToken");
      if (!token) throw new Error("جلسة غير صالحة");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("فشل قراءة الملف"));
        reader.readAsDataURL(file);
      });
      const ext = file.name.split(".").pop() || "";
      const res = await fetch("/api/wall/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: base64, filename: file.name, contentType: file.type }),
      });
      const data = await res.json();
      if (data.success) return { url: data.url, type: data.type === "image" ? "image" : "video" };
      throw new Error(data.message || "فشل رفع الملف");
    } catch (err) {
      console.error("Upload error:", err);
      return null;
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newPending: { file: File; preview: string; type: "image" | "video" }[] = [];
    for (let i = 0; i < files.length && pendingFiles.length + newPending.length < 4; i++) {
      const f = files[i];
      if (f.type.startsWith("image/")) {
        newPending.push({ file: f, preview: URL.createObjectURL(f), type: "image" });
      } else if (f.type.startsWith("video/")) {
        newPending.push({ file: f, preview: URL.createObjectURL(f), type: "video" });
      }
    }
    setPendingFiles((prev) => [...prev, ...newPending]);
    e.target.value = "";
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSendWithMedia = async (text: string) => {
    if (pendingFiles.length === 0) return;
    setIsSending(true);
    try {
      const uploadedUrls: string[] = [];
      let firstType: "image" | "video" = "image";
      for (const pf of pendingFiles) {
        const result = await uploadFile(pf.file);
        if (result) {
          uploadedUrls.push(result.url);
          firstType = result.type;
        }
      }
      if (uploadedUrls.length > 0) {
        onSendMedia?.(uploadedUrls[0], firstType, text, uploadedUrls.length > 1 ? uploadedUrls : undefined);
      }
      setMessage("");
      setPendingFiles([]);
    } finally {
      setIsSending(false);
      const socket = getSocket();
      socket.emit("stop_typing", { roomId });
    }
  };

  const uploadAudio = async (blob: Blob): Promise<string | undefined> => {
    setIsUploading(true);
    try {
      const token = localStorage.getItem("authToken");
      if (!token) throw new Error("جلسة غير صالحة");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("فشل قراءة الملف"));
        reader.readAsDataURL(blob);
      });
      const ext = blob.type.includes("webm") ? "webm" : "mp3";
      const res = await fetch("/api/wall/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: base64, filename: `voice.${ext}`, contentType: blob.type }),
      });
      const data = await res.json();
      if (data.success) return data.url;
      throw new Error(data.message || "فشل رفع التسجيل");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendVoice = async () => {
    if (!recorder.audioBlob) return;
    setIsSending(true);
    try {
      const url = await uploadAudio(recorder.audioBlob);
      if (url) {
        onSendMedia?.(url, "audio", message.trim() || undefined);
        setMessage("");
      }
    } finally {
      setIsSending(false);
      recorder.clearRecording();
      const socket = getSocket();
      socket.emit("stop_typing", { roomId });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let text = message.trim();
    if (selectedVideo) {
      const videoUrl = `https://www.youtube.com/watch?v=${selectedVideo.id}`;
      text = text ? `${text}\n${videoUrl}` : videoUrl;
    }
    if (!text && pendingFiles.length === 0) return;
    if (isSending) return;

    if (pendingFiles.length > 0) {
      await handleSendWithMedia(text);
      setSelectedVideo(null);
      setShowYouTubeSearch(false);
      return;
    }

    // Check for animated face shortcuts within text
    if (animatedFaces.length > 0) {
      let processedText = text;
      const matchedFaceUrls: string[] = [];
      for (const face of animatedFaces) {
        const regex = new RegExp(face.shortcut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        if (regex.test(processedText)) {
          const faceIdx = matchedFaceUrls.length;
          const matches = processedText.match(regex);
          if (matches) {
            for (let i = 0; i < matches.length; i++) {
              matchedFaceUrls.push(face.image_url);
            }
          }
          let counter = 0;
          processedText = processedText.replace(regex, () => `\u200B[[FACE:${faceIdx + counter++}]]\u200B`);
        }
      }
      if (matchedFaceUrls.length > 0) {
        setIsSending(true);
        setMessage("");
        setSelectedVideo(null);
        setShowYouTubeSearch(false);
        try {
          await onSendMessage(processedText, matchedFaceUrls);
        } finally {
          setIsSending(false);
          const socket = getSocket();
          socket.emit("stop_typing", { roomId });
        }
        return;
      }
    }

    setIsSending(true);
    setMessage("");
    setSelectedVideo(null);
    setShowYouTubeSearch(false);

    try {
      await onSendMessage(text);
    } finally {
      setIsSending(false);
      const socket = getSocket();
      socket.emit("stop_typing", { roomId });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    const socket = getSocket();
    if (!typingTimerRef.current) {
      socket.emit("typing", { roomId });
      typingTimerRef.current = setTimeout(() => {
        typingTimerRef.current = null;
      }, 1000);
    }
  };

  return (
    <div ref={inputAreaRef} className="z-10 border-t border-border bg-card shadow-lg [direction:ltr] relative" dir="ltr">
      {/* شريط معاينة التسجيل الصوتي */}
      {recorder.isRecording && (
        <div className="px-3 pt-2 border-b border-border">
          <div className="flex items-center gap-3 px-3 py-2 bg-red-500/5 rounded-xl border-l-4 border-red-500 animate-pulse">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
            <p className="text-xs font-bold text-red-600">
              جاري التسجيل {formatDuration(recorder.duration)}
            </p>
            <div className="flex-1" />
            <button type="button" onClick={recorder.isPaused ? recorder.resumeRecording : recorder.pauseRecording} className="text-xs font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition">
              {recorder.isPaused ? "استئناف" : "إيقاف مؤقت"}
            </button>
            <button type="button" onClick={recorder.stopRecording} className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-lg transition">
              إيقاف
            </button>
          </div>
        </div>
      )}

      {/* شريط معاينة التسجيل الجاهز */}
      {recorder.audioBlob && !recorder.isRecording && (
        <div className="px-3 pt-2 border-b border-border">
          <div className="flex items-center gap-3 px-3 py-2 bg-green-500/5 rounded-xl border-l-4 border-green-500">
            <AudioLines size={14} className="text-green-600 shrink-0" />
            <p className="text-xs font-bold text-green-600">
              تسجيل صوتي {formatDuration(recorder.duration)}
            </p>
            <div className="flex-1" />
            <button type="button" onClick={recorder.clearRecording} className="text-xs font-bold text-muted-foreground hover:text-red-600 px-2 py-1 rounded-lg hover:bg-muted transition">
              حذف
            </button>
            <button type="button" onClick={handleSendVoice} disabled={isSending || isUploading} className="text-xs font-bold text-white bg-green-500 hover:bg-green-600 px-2 py-1 rounded-lg transition disabled:opacity-50">
              {isUploading ? "جاري الرفع..." : "إرسال"}
            </button>
          </div>
        </div>
      )}

      {/* شريط معاينة الرد */}
      {replyToMsg && (
        <div className="px-3 pt-2 border-b border-border">
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-xl border-l-4 border-primary">
            <Reply size={14} className="text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-primary">
                الرد على {replyToMsg.user}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {replyToMsg.text || "..."}
              </p>
            </div>
            <button
              onClick={onCancelReply}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-muted transition"
            >
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* معاينة الفيديو المختار من يوتيوب */}
      {selectedVideo && (
        <div className="px-3 pt-2 border-b border-border bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/50 rounded-xl border-l-4 border-red-500">
            <div className="relative shrink-0 w-12 h-8 rounded-lg overflow-hidden bg-slate-200">
              <img src={selectedVideo.thumbnail} className="w-full h-full object-cover" alt="" />
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                <Youtube size={10} className="text-red-500" />
              </div>
            </div>
            <div className="flex-1 min-w-0 text-right" dir="rtl">
              <p className="text-[9px] font-bold text-red-600">فيديو YouTube المختار</p>
              <p className="text-[10px] text-foreground truncate animate-pulse" dir="auto">
                {selectedVideo.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedVideo(null)}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-muted transition"
            >
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* لوحة البحث في يوتيوب */}
      {showYouTubeSearch && (
        <div className="p-3 border-b border-border bg-slate-50 dark:bg-slate-900/40 animate-in slide-in-from-bottom duration-200">
          <YouTubeSearchInline
            onSelectVideo={(video) => setSelectedVideo(video)}
            selectedVideoId={selectedVideo?.id}
          />
        </div>
      )}

      {/* معاينة الملفات المختارة */}
      {pendingFiles.length > 0 && (
        <div className="px-3 pt-2 border-b border-border">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {pendingFiles.map((pf, idx) => (
              <div key={idx} className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 border-primary/30 bg-muted group">
                {pf.type === "image" ? (
                  <img src={pf.preview} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-900">
                    <Video size={24} className="text-white/70" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removePendingFile(idx)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center transition opacity-0 group-hover:opacity-100"
                >
                  <X size={10} />
                </button>
                {pf.type === "video" && (
                  <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[8px] font-bold text-white">
                    فيديو
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* لوحة الإيموجي مدمجة */}
      <EmojiPanel
        onEmojiSelect={(emoji) => setMessage((prev) => prev + emoji)}
        onAnimatedFaceSelect={onSendAnimatedFace}
        search={emojiSearch}
        setSearch={setEmojiSearch}
        activeCategory={activeEmojiCat}
        setActiveCategory={setActiveEmojiCat}
        isOpen={showEmoji}
      />

      {/* لوحة الملصقات */}
      {showStickers && (
        <div className="border-b border-border bg-card animate-in slide-in-from-bottom duration-200">
          {/* أقسام الملصقات */}
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
          {/* شبكة الملصقات */}
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
                  onSendAnimatedFace?.(face.image_url);
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

      <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex gap-1">
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isSending || isUploading}
                className={`h-10 w-10 rounded-xl transition-colors ${menuOpen || showEmoji || showFaces || showStickers || showYouTubeSearch ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-primary"}`}
                title="أدوات الغرفة"
              >
                {(showEmoji || showFaces || showStickers || showYouTubeSearch) ? <X size={18} /> : <Plus size={18} />}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-2 mb-2 z-50">
              <div className="flex gap-1 flex-wrap justify-center">
                <button type="button" onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted transition active:scale-90" title="إرسال صورة أو فيديو">
                  <ImagePlus size={22} className="text-green-500" />
                  <span className="text-[9px] font-bold">صورة</span>
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); closeAllPanels(); setShowYouTubeSearch(true); }} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted transition active:scale-90" title="بحث YouTube">
                  <Youtube size={22} className="text-red-500" />
                  <span className="text-[9px] font-bold">يوتيوب</span>
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); closeAllPanels(); setShowStickers(true); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showStickers ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="ملصقات">
                  <span className="text-[20px] leading-none">🖼️</span>
                  <span className="text-[9px] font-bold">ملصقات</span>
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); closeAllPanels(); setShowFaces(true); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showFaces ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="فيسات متحركة">
                  <Smile size={22} className="text-orange-500" />
                  <span className="text-[9px] font-bold">فيسات</span>
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); closeAllPanels(); setShowEmoji(true); }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showEmoji ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} title="إيموجي">
                  <SmilePlus size={22} className="text-yellow-500" />
                  <span className="text-[9px] font-bold">إيموجي</span>
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); if (recorder.isRecording) { recorder.stopRecording(); } else { recorder.startRecording(); } }} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${recorder.isRecording ? "bg-red-500 text-white" : "hover:bg-muted"}`} title={recorder.isRecording ? "إيقاف التسجيل" : "تسجيل صوتي"}>
                  {recorder.isRecording ? <MicOff size={22} /> : <AudioLines size={22} className="text-red-500" />}
                  <span className="text-[9px] font-bold">{recorder.isRecording ? "إيقاف" : "صوت"}</span>
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); }} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted transition active:scale-90" title="هدايا">
                  <Gift size={22} className="text-pink-500" />
                  <span className="text-[9px] font-bold">هدايا</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="relative flex-1">
          <Input
            placeholder="اكتب رسالة..."
            className="h-10 rounded-xl border-border bg-muted text-xs font-bold text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
            value={message}
            onChange={handleInputChange}
            dir="ltr"
            maxLength={1000}
          />
        </div>
        <Button type="submit" disabled={(!message.trim() && !selectedVideo && pendingFiles.length === 0) || isSending || isUploading} className={`h-10 w-10 rounded-xl p-0 shadow-lg ${message.trim() || selectedVideo || pendingFiles.length > 0 ? "bg-primary shadow-primary/20" : "bg-slate-100 text-muted-foreground"}`}>
          {isSending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
        </Button>
      </form>
    </div>
  );
});

const RoomPage = ({
  room,
  onBack,
  onSelectRoom,
  isEmbedded = false,
  onOpenProfile,
  onOpenSidebar,
  onOpenNotifications,
  onLogout,
}: any) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [showMics, setShowMics] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [replyToMsg, setReplyToMsg] = useState<ChatMessage | null>(null);
  const [openActionMsgId, setOpenActionMsgId] = useState<string | null>(null);
  const [activeYouTubeEmbedUrl, setActiveYouTubeEmbedUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasJoinedOnceRef = useRef(false);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const currentUser = getStoredUser();

  const roomId = useMemo(() => String(room?.id ?? "general"), [room?.id]);

  useEffect(() => {
    setMessages([]);
    setTypingUsers([]);
    setError("");
    setIsLoading(true);
    setReplyToMsg(null);
    setActiveReactionMsgId(null);
    setOpenActionMsgId(null);
    setActiveYouTubeEmbedUrl(null);
  }, [roomId]);

  // إغلاق قائمة التفاعل عند النقر خارجها
  useEffect(() => {
    if (!activeReactionMsgId && !openActionMsgId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setActiveReactionMsgId(null);
      }
      // إغلاق أزرار الإجراءات عند النقر خارج أي رسالة
      const target = e.target as HTMLElement;
      if (!target.closest("[data-msg-actions]")) {
        setOpenActionMsgId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeReactionMsgId, openActionMsgId]);

  // الانتقال إلى رسالة محددة
  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`room-msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
    el.style.transition = "box-shadow 0.3s ease";
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
    }, 2000);
  }, []);

  // إرسال تفاعل
  const handleReact = useCallback((messageId: string, reaction: ReactionType) => {
    const socket = getSocket();
    if (!socket || !socket.connected) return;
    socket.emit("room:react", { roomId, messageId, reaction });
    setActiveReactionMsgId(null);
  }, [roomId]);

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((current) => {
      const byKey = new Map<string, ChatMessage>();

      current.forEach((item) => {
        byKey.set(item.clientId || item.id, item);
      });

      incoming.forEach((item) => {
        byKey.set(item.clientId || item.id, item);
      });

      return Array.from(byKey.values()).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    });
  }, []);

  // ربط Socket.io
  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setIsConnected(true);
      // الانضمام للغرفة
      socket.emit("join_room", { roomId, isReconnect: hasJoinedOnceRef.current }, (res: any) => {
        if (res?.success) {
          hasJoinedOnceRef.current = true;
          if (res.messages) {
            mergeMessages(res.messages);
          }
          if (res.members) {
            setMembers(res.members);
          }
          setMemberCount(res.memberCount || 0);
          setError("");
        } else {
          setError(res?.message || "تعذر الانضمام للغرفة");
        }
        setIsLoading(false);
      });
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onNewMessage = (data: { roomId: string; message: ChatMessage }) => {
      if (data.roomId === roomId) {
        mergeMessages([data.message]);
      }
    };

    const onUserJoined = (data: { user: RoomMember; memberCount: number }) => {
      setMembers((prev) => {
        if (prev.some((m) => m.id === data.user.id)) return prev;
        return [...prev, data.user];
      });
      setMemberCount(data.memberCount);
    };

    const onUserLeft = (data: { socketId: string; memberCount: number; username?: string }) => {
      setMemberCount(data.memberCount);
      if (data.username) {
        setMembers((prev) => prev.filter((m) => m.username !== data.username));
      }
    };

    const onRoomCountUpdate = (data: { roomId: string; memberCount: number }) => {
      if (data.roomId === roomId) {
        setMemberCount(data.memberCount);
      }
    };

    const onUserTyping = (data: { username: string }) => {
      setTypingUsers((prev) => {
        if (prev.includes(data.username)) return prev;
        return [...prev, data.username];
      });
      // إزالة بعد 2 ثانية
      setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u !== data.username));
      }, 2000);
    };

    const onSystemMessage = (data: {
      text: string;
      roomId: string;
      systemType?: "join" | "leave" | "transition";
      user?: {
        id: string;
        username: string;
        role: string;
        avatar: string;
        countryCode?: string;
        avatarFrameUrl?: string;
        giftIconUrl?: string;
      };
      targetRoom?: {
        id: string;
        name: string;
        image: string;
      };
    }) => {
      if (data.roomId === roomId) {
        mergeMessages([
          {
            id: `sys-${Date.now()}-${Math.random()}`,
            user: data.user?.username || "النظام",
            role: (data.user?.role as any) || "system",
            text: data.text,
            avatar: data.user?.avatar || "/pic.png",
            countryCode: data.user?.countryCode || "SA",
            avatarFrameUrl: data.user?.avatarFrameUrl || "",
            giftIconUrl: data.user?.giftIconUrl || "",
            color: data.user?.role === "admin" ? "text-red-600" : "text-teal-600",
            isSystem: true,
            systemType: data.systemType,
            targetRoom: data.targetRoom,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    };

    const onUserProfileUpdated = (data: any) => {
      if (!data?.userId) return;

      const nameMatcher = (name: string) =>
        name === data.username || (data.previousUsername && name === data.previousUsername);

      // Update room members list
      setMembers((prev) =>
        prev.map((m) => {
          if (m.id === data.userId || nameMatcher(m.username || m.name)) {
            return {
              ...m,
              username: data.username || m.username,
              avatar: data.avatar || m.avatar,
            };
          }
          return m;
        })
      );

      // Update room messages avatars and display name
      setMessages((prev) =>
        prev.map((msg) => {
          if (nameMatcher(msg.user)) {
            return {
              ...msg,
              user: data.username || msg.user,
              avatar: data.avatar || msg.avatar,
            };
          }
          return msg;
        })
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("new_message", onNewMessage);
    socket.on("user_joined", onUserJoined);
    socket.on("user_left", onUserLeft);
    socket.on("room_count_update", onRoomCountUpdate);
    socket.on("user_typing", onUserTyping);
    socket.on("system_message", onSystemMessage);
    socket.on("user_profile_updated", onUserProfileUpdated);

    const onRoomReaction = (data: { roomId: string; messageId: string; reactions: Record<string, ReactionType> }) => {
      if (data.roomId !== roomId) return;
      setMessages(prev =>
        prev.map(m => m.id === data.messageId ? { ...m, reactions: data.reactions } : m),
      );
    };
    socket.on("room_reaction", onRoomReaction);

    // إذا كان متصل بالفعل، انضم للغرفة مباشرة
    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("new_message", onNewMessage);
      socket.off("user_joined", onUserJoined);
      socket.off("user_left", onUserLeft);
      socket.off("room_count_update", onRoomCountUpdate);
      socket.off("user_typing", onUserTyping);
      socket.off("system_message", onSystemMessage);
      socket.off("user_profile_updated", onUserProfileUpdated);
      socket.off("room_reaction", onRoomReaction);
      socket.emit("leave_room", { roomId });
    };
  }, [roomId, mergeMessages]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = useCallback(async (text: string, animatedFaceUrls?: string[]) => {
    const user = getStoredUser();
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentReplyTo = replyToMsg;

    // Optimistic UI
    const pendingMessage: ChatMessage = {
      id: clientId,
      clientId,
      user: user.name,
      role: user.role,
      text,
      avatar: user.avatar,
      countryCode: user.countryCode,
      avatarFrameUrl: user.avatarFrameUrl,
      giftIconUrl: user.giftIconUrl,
      messageBubbleStyle: user.messageBubbleStyle,
      color: user.role === "admin" ? "text-red-600" : "text-foreground",
      isOwner: user.role === "admin",
      reactions: {},
      replyToId: currentReplyTo?.id || undefined,
      replyToText: currentReplyTo?.text || undefined,
      replyToSenderName: currentReplyTo?.user || undefined,
      animatedFaces: animatedFaceUrls && animatedFaceUrls.length > 0 ? animatedFaceUrls : undefined,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    mergeMessages([pendingMessage]);
    setReplyToMsg(null);

    return new Promise<void>((resolve) => {
      const socket = getSocket();
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        setMessages((current) =>
          current.map((item) =>
            item.clientId === clientId
              ? { ...item, pending: false, failed: true, text: `${item.text} - لم يصل رد السيرفر` }
              : item,
          ),
        );
        setError("تعذر إرسال الرسالة. تحقق من اتصال السيرفر.");
        resolve();
      }, 8000);

      socket.emit("room_message", {
        roomId,
        text,
        clientId,
        replyToId: currentReplyTo?.id || undefined,
        replyToText: currentReplyTo?.text || undefined,
        replyToSenderName: currentReplyTo?.user || undefined,
        animatedFaces: animatedFaceUrls && animatedFaceUrls.length > 0 ? animatedFaceUrls : undefined,
      }, (res: any) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);

        if (res?.success && res.message) {
          mergeMessages([res.message]);
        } else {
          setMessages((current) =>
            current.map((item) =>
              item.clientId === clientId
                ? { ...item, pending: false, failed: true, text: `${item.text} - فشل الإرسال` }
                : item,
            ),
          );
          setError(res?.message || "فشل إرسال الرسالة");
        }
        resolve();
      });
    });
  }, [roomId, mergeMessages, replyToMsg]);

  const handleSendMedia = useCallback(async (mediaUrl: string, mediaType: "image" | "video" | "audio", text?: string, mediaUrls?: string[]) => {
    const user = getStoredUser();
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentReplyTo = replyToMsg;

    const pendingMessage: ChatMessage = {
      id: clientId,
      clientId,
      user: user.name,
      role: user.role,
      text: text || (mediaType === "audio" ? "🎤 رسالة صوتية" : ""),
      avatar: user.avatar,
      countryCode: user.countryCode,
      avatarFrameUrl: user.avatarFrameUrl,
      giftIconUrl: user.giftIconUrl,
      messageBubbleStyle: user.messageBubbleStyle,
      color: user.role === "admin" ? "text-red-600" : "text-foreground",
      isOwner: user.role === "admin",
      reactions: {},
      replyToId: currentReplyTo?.id || undefined,
      replyToText: currentReplyTo?.text || undefined,
      replyToSenderName: currentReplyTo?.user || undefined,
      mediaUrl,
      mediaUrls,
      mediaType,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    mergeMessages([pendingMessage]);
    setReplyToMsg(null);

    return new Promise<void>((resolve) => {
      const socket = getSocket();
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        setMessages((current) =>
          current.map((item) =>
            item.clientId === clientId
              ? { ...item, pending: false, failed: true, text: `${item.text} - لم يصل رد السيرفر` }
              : item,
          ),
        );
        setError("تعذر إرسال الرسالة. تحقق من اتصال السيرفر.");
        resolve();
      }, 8000);

      socket.emit("room_message", {
        roomId,
        text: text || "",
        clientId,
        replyToId: currentReplyTo?.id || undefined,
        replyToText: currentReplyTo?.text || undefined,
        replyToSenderName: currentReplyTo?.user || undefined,
        mediaUrl,
        mediaUrls,
        mediaType,
      }, (res: any) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);

        if (res?.success && res.message) {
          mergeMessages([res.message]);
        } else {
          setMessages((current) =>
            current.map((item) =>
              item.clientId === clientId
                ? { ...item, pending: false, failed: true, text: `${item.text} - فشل الإرسال` }
                : item,
            ),
          );
          setError(res?.message || "فشل إرسال الرسالة");
        }
        resolve();
      });
    });
  }, [roomId, mergeMessages, replyToMsg]);

  const handleSendAnimatedFace = useCallback(async (faceUrl: string) => {
    const user = getStoredUser();
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentReplyTo = replyToMsg;

    const pendingMessage: ChatMessage = {
      id: clientId,
      clientId,
      user: user.name,
      role: user.role,
      text: "",
      avatar: user.avatar,
      countryCode: user.countryCode,
      avatarFrameUrl: user.avatarFrameUrl,
      giftIconUrl: user.giftIconUrl,
      messageBubbleStyle: user.messageBubbleStyle,
      color: user.role === "admin" ? "text-red-600" : "text-foreground",
      isOwner: user.role === "admin",
      reactions: {},
      replyToId: currentReplyTo?.id || undefined,
      replyToText: currentReplyTo?.text || undefined,
      replyToSenderName: currentReplyTo?.user || undefined,
      animatedFaces: [faceUrl],
      createdAt: new Date().toISOString(),
      pending: true,
    };

    mergeMessages([pendingMessage]);
    setReplyToMsg(null);

    return new Promise<void>((resolve) => {
      const socket = getSocket();
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        setMessages((current) =>
          current.map((item) =>
            item.clientId === clientId
              ? { ...item, pending: false, failed: true }
              : item,
          ),
        );
        resolve();
      }, 8000);

      socket.emit("room_message", {
        roomId,
        text: "",
        clientId,
        replyToId: currentReplyTo?.id || undefined,
        replyToText: currentReplyTo?.text || undefined,
        replyToSenderName: currentReplyTo?.user || undefined,
        animatedFaces: [faceUrl],
      }, (res: any) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);

        if (res?.success && res.message) {
          mergeMessages([res.message]);
        }
        resolve();
      });
    });
  }, [roomId, mergeMessages, replyToMsg]);

  const handleSendSticker = useCallback(async (stickerUrl: string) => {
    const user = getStoredUser();
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentReplyTo = replyToMsg;

    const pendingMessage: ChatMessage = {
      id: clientId,
      clientId,
      user: user.name,
      role: user.role,
      text: "",
      avatar: user.avatar,
      countryCode: user.countryCode,
      avatarFrameUrl: user.avatarFrameUrl,
      giftIconUrl: user.giftIconUrl,
      messageBubbleStyle: user.messageBubbleStyle,
      color: user.role === "admin" ? "text-red-600" : "text-foreground",
      isOwner: user.role === "admin",
      reactions: {},
      replyToId: currentReplyTo?.id || undefined,
      replyToText: currentReplyTo?.text || undefined,
      replyToSenderName: currentReplyTo?.user || undefined,
      sticker: stickerUrl,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    mergeMessages([pendingMessage]);
    setReplyToMsg(null);

    return new Promise<void>((resolve) => {
      const socket = getSocket();
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        setMessages((current) =>
          current.map((item) =>
            item.clientId === clientId
              ? { ...item, pending: false, failed: true }
              : item,
          ),
        );
        resolve();
      }, 8000);

      socket.emit("room_message", {
        roomId,
        text: "",
        clientId,
        replyToId: currentReplyTo?.id || undefined,
        replyToText: currentReplyTo?.text || undefined,
        replyToSenderName: currentReplyTo?.user || undefined,
        sticker: stickerUrl,
      }, (res: any) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);

        if (res?.success && res.message) {
          mergeMessages([res.message]);
        }
        resolve();
      });
    });
  }, [roomId, mergeMessages, replyToMsg]);

  return (
    <div dir="ltr" className={`relative flex h-full flex-col bg-card [direction:ltr] ${!isEmbedded ? "fixed inset-0 z-[60]" : ""}`}>
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between border-b border-border bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          {!isEmbedded && (
            <Button variant="ghost" size="icon" onClick={onBack} className="rounded-xl">
              <ChevronLeft size={24} />
            </Button>
          )}
          <div className="relative">
            <Avatar className="h-10 w-10 rounded-xl border border-border shadow-sm">
              <AvatarImage src={room.image} />
              <AvatarFallback>{room.name?.[0] ?? "غ"}</AvatarFallback>
            </Avatar>
            <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
          </div>
          <div dir="ltr">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-black leading-tight text-foreground">{room.name}</h3>
              <Crown size={12} className="text-yellow-500" />
            </div>
            <p className="text-[9px] font-bold text-muted-foreground">
              {memberCount > 0 ? `${memberCount} متصل` : "بواسطة: " + room.owner}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Notifications bell from site header */}
          {onOpenNotifications && (
            <NotificationsBell onOpen={onOpenNotifications} />
          )}

          <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className={`h-9 w-9 rounded-xl ${isMuted ? "bg-red-50 text-red-500" : "text-muted-foreground"}`}>
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowMics(!showMics)} className={`h-9 w-9 rounded-xl ${showMics ? "bg-primary/5 text-primary" : "text-muted-foreground"}`}>
            <Mic2 size={18} />
          </Button>

          <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 rounded-xl text-red-500 hover:bg-red-50">
            <X size={18} />
          </Button>
        </div>
      </header>

      {showMics && (
        <div className="absolute top-[56px] inset-x-0 z-10 grid grid-cols-5 gap-2 overflow-x-auto border-b border-border bg-slate-50/80 dark:bg-slate-800/80 backdrop-blur-md p-2 no-scrollbar">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="relative">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${i === 1 ? "border-primary bg-card shadow-sm" : "border-border bg-slate-100"}`}>
                  {i === 1 ? (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="https://i.pravatar.cc/150?u=active-speaker" />
                      <AvatarFallback>م</AvatarFallback>
                    </Avatar>
                  ) : (
                    <MicOff size={14} className="text-slate-300" />
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 rounded-full border border-border bg-card px-1 text-[8px] font-black">
                  {i}
                </div>
              </div>
              <span className="w-12 truncate text-center text-[8px] font-bold text-muted-foreground">{i === 1 ? "متحدث" : "فارغ"}</span>
            </div>
          ))}
        </div>
      )}

      {/* مشغل يوتيوب المدمج */}
      {activeYouTubeEmbedUrl && (
        <div className="absolute top-[56px] inset-x-0 z-30 bg-black border-b border-slate-800 shadow-xl animate-in slide-in-from-top duration-300">
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

      <div ref={scrollRef} dir="ltr" className={`flex-1 space-y-3 overflow-y-auto bg-muted/50 p-3 [direction:ltr] ${showMics ? "pt-[120px]" : "pt-[64px]"}`}>
        {isLoading && (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="animate-spin" size={20} />
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-lg border border-red-100 bg-red-50 p-2 text-center text-xs font-bold text-red-600 [direction:ltr]" dir="ltr">
            {error}
          </div>
        )}

        {!isLoading && messages.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-3 text-center text-xs font-bold text-muted-foreground [direction:ltr]" dir="ltr">
            لا توجد رسائل بعد
          </div>
        )}

        {messages.map((msg) => {
          const isSystem = msg.isSystem;
          const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;

          return (
          <div key={msg.clientId || msg.id} id={`room-msg-${msg.id}`} className={`flex gap-3 group ${msg.pending ? "opacity-70" : ""} transition-all duration-300`}>
            <div className="relative shrink-0">
              <div
                className="rounded-xl bg-cover bg-center p-0.5 cursor-pointer transition hover:scale-105"
                style={msg.avatarFrameUrl ? { backgroundImage: `url(${msg.avatarFrameUrl})` } : undefined}
                onClick={() => onOpenProfile?.(msg.user)}
              >
                <Avatar className="h-9 w-9 rounded-xl border border-white shadow-sm">
                  <AvatarImage src={msg.avatar} />
                  <AvatarFallback>{msg.user[0]}</AvatarFallback>
                </Avatar>
              </div>
            </div>
            <div className="min-w-0 flex-1" dir="ltr">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 
                  className={`text-[11px] font-black cursor-pointer hover:underline ${msg.color}`}
                  onClick={() => onOpenProfile?.(msg.user)}
                >
                  {msg.user}
                </h4>
                <img src={getCountryFlagSrc(msg.countryCode)} alt={msg.countryCode} className="h-3 w-4 rounded-sm object-cover" />
                {msg.giftIconUrl && <img src={msg.giftIconUrl} alt="gift" className="h-4 w-4 rounded object-cover" />}
                {msg.isOwner && <Badge className="h-3.5 rounded-sm border-none bg-blue-600 px-1 text-[8px] font-black text-white">مالك الموقع</Badge>}
                <span className="ms-auto text-[8px] font-bold text-muted-foreground">
                  {msg.pending ? "جار الإرسال" : msg.failed ? "فشل" : formatMessageTime(msg.createdAt)}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-1">
                {msg.animatedFaces && msg.animatedFaces.length > 0 && !msg.text && !msg.replyToId && !msg.mediaUrl && !msg.mediaUrls?.length ? (
                  /* فيس متحرك - بدون فقاعة */
                  <div className="py-0.5 flex items-center gap-0.5">
                    {msg.animatedFaces.map((faceUrl, i) => (
                      <img key={i} src={faceUrl} alt="فيس متحرك" className="object-contain" style={{ width: "40px", height: "40px" }} />
                    ))}
                  </div>
                ) : msg.sticker && !msg.text && !msg.replyToId && !msg.mediaUrl && !msg.mediaUrls?.length ? (
                  /* ملصق فقط - بدون فقاعة */
                  <div className="py-0.5">
                    <img src={msg.sticker} alt="ملصق" className="w-[120px] h-[120px] object-contain" />
                  </div>
                ) : (
                <div className={`relative inline-block max-w-[90%] rounded-2xl rounded-tl-none border p-2.5 shadow-sm ${getMessageBubbleClass(msg)}`}>
                  {/* اقتباس الرد */}
                  {msg.replyToId && (
                    <div
                      className="mb-2 px-3 py-2 rounded-xl border-l-4 border-primary/40 bg-muted/30 cursor-pointer hover:bg-muted/50 transition"
                      onClick={() => scrollToMessage(msg.replyToId!)}
                    >
                      <p className="text-[9px] font-bold text-primary">
                        {msg.replyToSenderName || "عضو"}
                      </p>
                      <p className="text-[9px] text-muted-foreground truncate max-w-[200px]">
                        {msg.replyToText || "..."}
                      </p>
                    </div>
                  )}

                  {/* ملصق */}
                  {msg.sticker && (
                    <div className="py-1">
                      {msg.sticker.startsWith("/") || msg.sticker.startsWith("http") ? (
                        <img src={msg.sticker} alt="ملصق" className="w-[100px] h-[100px] object-contain" />
                      ) : (
                        <span className="text-5xl leading-none select-none">{msg.sticker}</span>
                      )}
                    </div>
                  )}

                  {/* صورة أو فيديو */}
                  {msg.mediaType === "image" && (msg.mediaUrls?.length || msg.mediaUrl) && (
                    <div className="mb-2">
                      {msg.mediaUrls && msg.mediaUrls.length > 1 ? (
                        <div className={`grid gap-1 ${msg.mediaUrls.length === 2 ? "grid-cols-2" : msg.mediaUrls.length <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
                          {msg.mediaUrls.map((url, idx) => (
                            <div
                              key={idx}
                              className="relative rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition bg-muted"
                              onClick={() => window.open(url, "_blank")}
                            >
                              <img
                                src={url}
                                alt={`صورة ${idx + 1}`}
                                className="w-full h-full object-cover"
                                style={{ minHeight: 80, maxHeight: 180 }}
                                loading="lazy"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <img
                          src={msg.mediaUrls?.[0] || msg.mediaUrl}
                          alt="صورة"
                          className="max-w-[250px] max-h-[250px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition"
                          onClick={() => window.open(msg.mediaUrls?.[0] || msg.mediaUrl || "", "_blank")}
                          loading="lazy"
                        />
                      )}
                    </div>
                  )}
                  {msg.mediaType === "video" && msg.mediaUrl && (
                    <div className="mb-2">
                      <video
                        controls
                        preload="metadata"
                        className="max-w-[280px] max-h-[250px] rounded-xl"
                        src={msg.mediaUrl}
                      />
                    </div>
                  )}

                  {/* مشغل الصوت */}
                  {msg.mediaType === "audio" && msg.mediaUrl && (
                    <div className="mb-2 min-w-[200px]">
                      <VoiceMessagePlayer src={msg.mediaUrl} />
                    </div>
                  )}

                  {msg.text && <p className="break-words text-xs font-bold leading-relaxed inline">{renderTextWithFaces(msg.text, msg.animatedFaces)}</p>}
                  {!isSystem && findYouTubeLinks(msg.text).map((link) => (
                    <YouTubePreviewCard
                      key={link}
                      url={link}
                      onPlay={(embedUrl) => setActiveYouTubeEmbedUrl(embedUrl)}
                    />
                  ))}
                  {msg.isSystem && msg.systemType === "transition" && msg.targetRoom && (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200/50 bg-white/40 dark:border-slate-700/50 dark:bg-slate-900/40 p-3 shadow-md backdrop-blur-md transition-all duration-300 hover:shadow-lg hover:bg-white/60 dark:hover:bg-slate-900/60 flex items-center justify-between gap-4 max-w-[280px]">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-10 w-10 rounded-xl border border-white dark:border-slate-800 shadow-sm shrink-0">
                          <AvatarImage src={msg.targetRoom.image} />
                          <AvatarFallback>{msg.targetRoom.name?.[0] || "غ"}</AvatarFallback>
                        </Avatar>
                        <div className="text-left min-w-0">
                          <h5 className="text-[11px] font-black text-slate-800 dark:text-white truncate leading-tight">{msg.targetRoom.name}</h5>
                          <span className="text-[8px] font-bold text-slate-400 dark:text-slate-500">غرفة محادثة نشطة</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => onSelectRoom?.({
                          id: msg.targetRoom?.id,
                          name: msg.targetRoom?.name,
                          image: msg.targetRoom?.image,
                          owner: "إدارة الموقع"
                        })}
                        className="h-7 rounded-lg bg-primary hover:bg-primary/95 text-[9px] font-black text-white px-3 flex items-center gap-1 shadow-md shadow-primary/10 transition-all active:scale-95 shrink-0"
                      >
                        <span>انضمام</span>
                      </Button>
                    </div>
                  )}
                </div>
                )}

                {/* أزرار التفاعل والرد */}
                {!isSystem && !msg.pending && !msg.failed && (
                  <div className="relative flex items-center gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" data-msg-actions>
                    <button
                      onClick={(e) => { e.stopPropagation(); setActiveReactionMsgId(activeReactionMsgId === msg.id ? null : msg.id); }}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-border shadow-sm hover:bg-muted transition active:scale-95"
                      title="تفاعل"
                    >
                      <SmilePlus size={13} className="text-muted-foreground" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setReplyToMsg(msg); }}
                      className="w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-border shadow-sm hover:bg-muted transition active:scale-95"
                      title="رد"
                    >
                      <Reply size={13} className="text-muted-foreground" />
                    </button>

                    {/* قائمة اختيار التفاعل */}
                    {activeReactionMsgId === msg.id && (
                      <div ref={reactionPickerRef} className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50">
                        <div className="flex items-center gap-0.5 px-2 py-1.5 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-border animate-in fade-in zoom-in-95 duration-100">
                          {REACTIONS_CONFIG.map(({ type, emoji, label }) => (
                            <button
                              key={type}
                              onClick={() => handleReact(msg.id, type)}
                              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-muted transition-all hover:scale-125 active:scale-95"
                              title={label}
                            >
                              <span className="text-lg leading-none">{emoji}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* عرض التفاعل */}
              {hasReactions && !isSystem && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(() => {
                    const counts: Partial<Record<ReactionType, number>> = {};
                    let myReaction: ReactionType | null = null;
                    for (const [, rt] of Object.entries(msg.reactions || {})) {
                      counts[rt] = (counts[rt] || 0) + 1;
                    }
                    const myUserId = String(currentUser?.id || currentUser?.name || "");
                    if (msg.reactions?.[myUserId]) myReaction = msg.reactions[myUserId];
                    return (Object.entries(counts) as [ReactionType, number][]).map(([type, count]) => {
                      const cfg = REACTIONS_CONFIG.find(r => r.type === type);
                      if (!cfg) return null;
                      return (
                        <button
                          key={type}
                          onClick={() => handleReact(msg.id, type)}
                          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-all hover:scale-110 ${
                            myReaction === type
                              ? "bg-primary/20 border border-primary/40"
                              : "bg-muted hover:bg-muted/80 border border-transparent"
                          }`}
                          title={cfg.label}
                        >
                          <span className="text-sm leading-none">{cfg.emoji}</span>
                          <span className={myReaction === type ? "text-primary" : "text-muted-foreground"}>{count}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
          );
        })}

        {/* مؤشر الكتابة */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 px-2 text-[10px] font-bold text-muted-foreground" dir="ltr">
            <div className="flex gap-0.5">
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
              <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
            </div>
            <span>{typingUsers.join("، ")} يكتب...</span>
          </div>
        )}
      </div>

      <ChatInputArea
        roomId={roomId}
        onSendMessage={handleSendMessage}
        onSendMedia={handleSendMedia}
        onSendSticker={handleSendSticker}
        onSendAnimatedFace={handleSendAnimatedFace}
        replyToMsg={replyToMsg}
        onCancelReply={() => setReplyToMsg(null)}
      />
    </div>
  );
};

export default RoomPage;
