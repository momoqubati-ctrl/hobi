"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, Send, Wifi, WifiOff, ImagePlus, X, SmilePlus, Reply, ArrowLeft, Youtube, Smile, Plus, Mic, MicOff } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useVoiceRecorder, formatDuration } from "@/lib/useVoiceRecorder";
import VoiceMessagePlayer from "./VoiceMessagePlayer";
import EmojiPickerPopover, { EmojiPanel } from "./EmojiPickerPopover";
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";
import { fetchAnimatedFaces, AnimatedFace } from "@/lib/animatedFaceData";
import { fetchStickerCategories, StickerCategory } from "@/lib/stickerData";
import { compressImage, COMPRESS_PRESETS } from "@/lib/image-compress";
import { YouTubeSearchInline, YTVideo } from "./YouTubeSearchInline";
import { YouTubePreviewCard, findYouTubeLinks } from "./YouTubePreviewCard";

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

// ─── أنواع البيانات ──────────────────────────────────────────────────────────

type ReactionType = "like" | "love" | "haha" | "wow" | "sad" | "angry";

const REACTIONS_CONFIG: { type: ReactionType; emoji: string; label: string }[] = [
  { type: "like",  emoji: "👍", label: "أعجبني" },
  { type: "love",  emoji: "❤️", label: "حب" },
  { type: "haha",  emoji: "😂", label: "ضحك" },
  { type: "wow",   emoji: "😮", label: "متفاجئ" },
  { type: "sad",   emoji: "😢", label: "حزين" },
  { type: "angry", emoji: "😡", label: "غاضب" },
];

interface PMMessage {
  id: string;
  clientId?: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  receiverId: string;
  text: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio";
  reactions?: Record<string, ReactionType>;
  replyToId?: string;
  replyToText?: string;
  replyToSenderName?: string;
  replyToMediaUrl?: string;
  replyToMediaType?: "image" | "video";
  animatedFaces?: string[];
  createdAt: string;
  read: boolean;
  pending?: boolean;
  failed?: boolean;
}

interface PendingMedia {
  file: File;
  previewUrl: string;
  type: "image" | "video";
}

const normalizePrivateMessage = (
  raw: any,
  fallback: Pick<PMMessage, "clientId" | "conversationId" | "senderId" | "senderName" | "senderAvatar" | "receiverId" | "text" | "mediaUrl" | "mediaType" | "replyToId" | "replyToText" | "replyToSenderName" | "replyToMediaUrl" | "replyToMediaType" | "animatedFaces">,
): PMMessage => ({
  id: String(raw?.id || fallback.clientId || `pm_${Date.now()}`),
  clientId: fallback.clientId,
  conversationId: String(raw?.conversationId || raw?.conversation_id || fallback.conversationId),
  senderId: String(raw?.senderId || raw?.sender_id || fallback.senderId),
  senderName: String(raw?.senderName || fallback.senderName || ""),
  senderAvatar: String(raw?.senderAvatar || fallback.senderAvatar || ""),
  receiverId: String(raw?.receiverId || raw?.receiver_id || fallback.receiverId),
  text: String(raw?.text ?? raw?.body ?? fallback.text ?? ""),
  mediaUrl: raw?.mediaUrl || fallback.mediaUrl,
  mediaType: raw?.mediaType || fallback.mediaType,
  reactions: raw?.reactions || {},
  replyToId: raw?.replyToId || fallback.replyToId,
  replyToText: raw?.replyToText || fallback.replyToText,
  replyToSenderName: raw?.replyToSenderName || fallback.replyToSenderName,
  replyToMediaUrl: raw?.replyToMediaUrl || fallback.replyToMediaUrl,
  replyToMediaType: raw?.replyToMediaType || fallback.replyToMediaType,
  animatedFaces: raw?.animatedFaces || fallback.animatedFaces,
  createdAt: String(raw?.createdAt || raw?.created_at || new Date().toISOString()),
  read: Boolean(raw?.read || raw?.readAt || raw?.read_at),
  pending: false,
  failed: false,
});

interface PrivateChatProps {
  conversationId: string;
  otherUser: { id: string; name: string; avatar: string };
  currentUserId: string;
  onBack: () => void;
  onOpenProfile?: (userId: string) => void;
  onSend?: (receiverId: string, text: string) => Promise<any>;
}

// ─── مكوّن المحادثة الخاصة ──────────────────────────────────────────────────

const PrivateChat = ({
  conversationId,
  otherUser,
  currentUserId,
  onBack,
  onOpenProfile,
}: PrivateChatProps) => {
  const currentUserRaw = typeof window !== "undefined" ? localStorage.getItem("user") : null;
  const currentUser = currentUserRaw ? JSON.parse(currentUserRaw) : null;
  const myAvatar = currentUser?.avatar || "/pic.png";

  const [messages, setMessages] = useState<PMMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [socketConnected, setSocketConnected] = useState(true);
  const [otherUserData, setOtherUserData] = useState(otherUser);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  const [replyToMsg, setReplyToMsg] = useState<PMMessage | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showFaces, setShowFaces] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stickerCategories, setStickerCategories] = useState<StickerCategory[]>([]);
  const [activeStickerCat, setActiveStickerCat] = useState<string | null>(null);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [activeEmojiCat, setActiveEmojiCat] = useState("animated");
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const { setPmUnreadCount, onlineUsers } = useRealtimeStore();
  const [selectedVideo, setSelectedVideo] = useState<YTVideo | null>(null);
  const [showYouTubeSearch, setShowYouTubeSearch] = useState(false);
  const [activeYouTubeEmbedUrl, setActiveYouTubeEmbedUrl] = useState<string | null>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const [animatedFaces, setAnimatedFaces] = useState<AnimatedFace[]>([]);
  const recorder = useVoiceRecorder();

  useEffect(() => {
    fetchAnimatedFaces().then((f) => { if (f.length > 0) setAnimatedFaces(f); });
  }, []);

  const closeAllPanels = useCallback(() => {
    setShowEmoji(false);
    setShowFaces(false);
    setShowStickers(false);
    setShowYouTubeSearch(false);
  }, []);

  useEffect(() => {
    if (!showEmoji && !showYouTubeSearch && !showStickers && !showFaces) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (inputAreaRef.current && !inputAreaRef.current.contains(e.target as Node)) {
        closeAllPanels();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmoji, showYouTubeSearch, showStickers, showFaces, closeAllPanels]);

  useEffect(() => {
    setSelectedVideo(null);
    setShowYouTubeSearch(false);
    setActiveYouTubeEmbedUrl(null);
  }, [conversationId]);

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

  // ─── إغلاق قائمة التفاعل عند النقر خارجها ────────────────────────────────

  useEffect(() => {
    if (!activeReactionMsgId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setActiveReactionMsgId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeReactionMsgId]);

  // ─── إرسال تفاعل ─────────────────────────────────────────────────────────

  const handleReact = useCallback((messageId: string, reaction: ReactionType) => {
    const socket = getSocket();
    if (!socket || !socket.connected) return;

    socket.emit("pm:react", {
      messageId,
      conversationId,
      reaction,
    });

    setActiveReactionMsgId(null);
  }, [conversationId]);

  // ─── رفع الملف到 السيرفر ─────────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File): Promise<{ url: string; type: "image" | "video" } | null> => {
    try {
      let fileToUpload = file;
      const isImage = file.type.startsWith("image/") && !file.type.startsWith("image/gif");

      if (isImage) {
        const result = await compressImage(file, COMPRESS_PRESETS.chat);
        fileToUpload = result.file;
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(fileToUpload);
      });

      const token = localStorage.getItem("authToken") || "";
      const res = await fetch("/api/pm/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          file: base64,
          filename: file.name,
          contentType: file.type,
        }),
      });

      const data = await res.json();
      if (data.success && data.url) {
        return { url: data.url, type: data.type as "image" | "video" };
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const uploadAudio = useCallback(async (blob: Blob): Promise<string | undefined> => {
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
      const res = await fetch("/api/pm/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: base64, filename: `voice.${ext}`, contentType: blob.type }),
      });
      const data = await res.json();
      if (data.success) return data.url;
      throw new Error(data.message || "فشل رفع التسجيل");
    } catch {
      return undefined;
    }
  }, []);

  const handleSendVoice = useCallback(async () => {
    if (!recorder.audioBlob || !otherUser?.id) return;
    setSending(true);
    try {
      const url = await uploadAudio(recorder.audioBlob);
      if (url) {
        const clientId = `pending_${Date.now()}_${Math.random()}`;
        const pendingMsg: PMMessage = {
          id: clientId,
          clientId,
          conversationId,
          senderId: currentUserId,
          senderName: currentUser?.name || currentUser?.username || "",
          senderAvatar: myAvatar,
          receiverId: otherUser.id,
          text: "",
          mediaUrl: url,
          mediaType: "audio" as const,
          reactions: {},
          createdAt: new Date().toISOString(),
          read: false,
          pending: true,
          failed: false,
        };
        setMessages(prev => [...prev, pendingMsg]);

        const socket = getSocket();
        if (socket?.connected) {
          socket.emit("pm:send", {
            toUserId: otherUser.id,
            text: "",
            clientId,
            mediaUrl: url,
            mediaType: "audio",
          }, (ackErrorOrRes: any, ackRes?: any) => {
            const res = ackRes ?? (ackErrorOrRes?.message === "operation has timed out" ? null : ackErrorOrRes);
            if (res?.success && res.message) {
              const sentMessage = normalizePrivateMessage(res.message, {
                clientId, conversationId, senderId: currentUserId,
                senderName: currentUser?.name || currentUser?.username || "",
                senderAvatar: myAvatar, receiverId: otherUser.id,
                text: "", mediaUrl: url, mediaType: "audio" as const,
              });
              setMessages(prev => prev.map(m => m.clientId === clientId ? sentMessage : m));
            } else {
              setMessages(prev => prev.map(m => m.clientId === clientId ? { ...m, pending: false, failed: true } : m));
            }
          });
        }
      }
    } finally {
      setSending(false);
      recorder.clearRecording();
    }
  }, [recorder.audioBlob, otherUser?.id, uploadAudio, conversationId, currentUserId, currentUser?.name, currentUser?.username, myAvatar]);

  // ─── اختيار ملف ───────────────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      alert("حجم الملف يتجاوز 50 ميجابايت");
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
      alert("الملفات المدعومة: الصور والفيديو فقط");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPendingMedia({ file, previewUrl, type: isImage ? "image" : "video" });

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRemoveMedia = useCallback(() => {
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.previewUrl);
    setPendingMedia(null);
  }, [pendingMedia]);

  // ─── إرسال رسالة ──────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const hasText = text.trim().length > 0 || !!selectedVideo;
    const hasMedia = !!pendingMedia;
    if ((!hasText && !hasMedia) || sending) return;

    const socket = getSocket();
    if (!socket || !socket.connected) return;

    let msgText = text.trim();
    if (selectedVideo) {
      const videoUrl = `https://www.youtube.com/watch?v=${selectedVideo.id}`;
      msgText = msgText ? `${msgText}\n${videoUrl}` : videoUrl;
    }

    // Check for animated face shortcuts within text
    let animatedFaceUrls: string[] | undefined;
    if (animatedFaces.length > 0 && msgText) {
      const matchedUrls: string[] = [];
      let processedText = msgText;
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
        msgText = processedText;
        animatedFaceUrls = matchedUrls;
      }
    }

    const clientId = `pending_${Date.now()}_${Math.random()}`;

    let mediaUrl = "";
    let mediaType: "image" | "video" | undefined;

    if (hasMedia) {
      setUploading(true);
      const uploaded = await uploadFile(pendingMedia.file);
      setUploading(false);
      if (!uploaded) {
        alert("فشل رفع الملف");
        return;
      }
      mediaUrl = uploaded.url;
      mediaType = uploaded.type;
    }

    const pendingMsg: PMMessage = {
      id: clientId,
      clientId,
      conversationId,
      senderId: currentUserId,
      senderName: "",
      senderAvatar: "",
      receiverId: otherUser.id,
      text: msgText,
      mediaUrl: mediaUrl || undefined,
      mediaType,
      reactions: {},
      replyToId: replyToMsg?.id || undefined,
      replyToText: replyToMsg?.text || undefined,
      replyToSenderName: replyToMsg?.senderName || undefined,
      replyToMediaUrl: replyToMsg?.mediaUrl || undefined,
      replyToMediaType: replyToMsg?.mediaType || undefined,
      animatedFaces: animatedFaceUrls,
      createdAt: new Date().toISOString(),
      read: false,
      pending: true,
      failed: false,
    };

    const currentReplyTo = replyToMsg;
    const messageFallback = {
      clientId,
      conversationId,
      senderId: currentUserId,
      senderName: currentUser?.name || currentUser?.username || "",
      senderAvatar: myAvatar,
      receiverId: otherUser.id,
      text: msgText,
      mediaUrl: mediaUrl || undefined,
      mediaType,
      replyToId: currentReplyTo?.id || undefined,
      replyToText: currentReplyTo?.text || undefined,
      replyToSenderName: currentReplyTo?.senderName || undefined,
      replyToMediaUrl: currentReplyTo?.mediaUrl || undefined,
      replyToMediaType: currentReplyTo?.mediaType || undefined,
      animatedFaces: animatedFaceUrls,
    };
    setMessages(prev => [...prev, pendingMsg]);
    setText("");
    setPendingMedia(null);
    setReplyToMsg(null);
    setSelectedVideo(null);
    setShowYouTubeSearch(false);
    setSending(true);

    socket.emit("pm:stop_typing", { toUserId: otherUser.id });

    const socketWithTimeout =
      typeof (socket as any).timeout === "function" ? (socket as any).timeout(8000) : socket;

    socketWithTimeout.emit(
      "pm:send",
      {
        toUserId: otherUser.id,
        text: msgText,
        clientId,
        mediaUrl: mediaUrl || undefined,
        mediaType,
        replyToId: currentReplyTo?.id || undefined,
        animatedFaces: animatedFaceUrls && animatedFaceUrls.length > 0 ? animatedFaceUrls : undefined,
      },
      async (ackErrorOrRes: any, ackRes?: any) => {
        const res = ackRes ?? (ackErrorOrRes?.message === "operation has timed out" ? null : ackErrorOrRes);
        setSending(false);
        if (res?.success && res.message) {
          const sentMessage = normalizePrivateMessage(res.message, messageFallback);
          setMessages(prev =>
            prev.map(m =>
              m.clientId === clientId
                ? sentMessage
                : m,
            ),
          );
        } else {
          if (!mediaUrl) {
            try {
              const apiRes = await fetch("/api/pm/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  senderId: currentUserId,
                  receiverId: otherUser.id,
                  text: msgText,
                  clientId,
                  animatedFaces: animatedFaceUrls && animatedFaceUrls.length > 0 ? animatedFaceUrls : undefined,
                }),
              });
              const apiData = await apiRes.json();
              if (apiRes.ok && apiData?.success && apiData.message) {
                const sentMessage = normalizePrivateMessage(apiData.message, messageFallback);
                setMessages(prev =>
                  prev.map(m =>
                    m.clientId === clientId
                      ? sentMessage
                      : m,
                  ),
                );
                return;
              }
            } catch {
              // keep failed state below
            }
          }
          setMessages(prev =>
            prev.map(m =>
              m.clientId === clientId ? { ...m, pending: false, failed: true } : m,
            ),
          );
        }
      },
    );
  }, [text, pendingMedia, sending, conversationId, currentUserId, otherUser.id, uploadFile, replyToMsg, selectedVideo, animatedFaces, currentUser?.name, currentUser?.username, myAvatar]);

  const handleSendSticker = useCallback(async (stickerUrl: string) => {
    const socket = getSocket();
    if (!socket || !socket.connected || !otherUser?.id) return;

    const clientId = `pending_${Date.now()}_${Math.random()}`;

    const pendingMsg: PMMessage = {
      id: clientId,
      clientId,
      conversationId,
      senderId: currentUserId,
      senderName: currentUser?.name || currentUser?.username || "",
      senderAvatar: myAvatar,
      receiverId: otherUser.id,
      text: "",
      mediaUrl: stickerUrl,
      mediaType: "image",
      reactions: {},
      createdAt: new Date().toISOString(),
      read: false,
      pending: true,
      failed: false,
    };

    setMessages(prev => [...prev, pendingMsg]);
    setReplyToMsg(null);
    closeAllPanels();

    const socketWithTimeout =
      typeof (socket as any).timeout === "function" ? (socket as any).timeout(8000) : socket;

    socketWithTimeout.emit(
      "pm:send",
      {
        toUserId: otherUser.id,
        text: "",
        clientId,
        mediaUrl: stickerUrl,
        mediaType: "image",
      },
      (ackErrorOrRes: any, ackRes?: any) => {
        const res = ackRes ?? (ackErrorOrRes?.message === "operation has timed out" ? null : ackErrorOrRes);
        if (res?.success && res.message) {
          const sentMessage = normalizePrivateMessage(res.message, {
            clientId,
            conversationId,
            senderId: currentUserId,
            senderName: currentUser?.name || currentUser?.username || "",
            senderAvatar: myAvatar,
            receiverId: otherUser.id,
            text: "",
            mediaUrl: stickerUrl,
            mediaType: "image" as const,
          });
          setMessages(prev =>
            prev.map(m =>
              m.clientId === clientId ? sentMessage : m,
            ),
          );
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.clientId === clientId ? { ...m, pending: false, failed: true } : m,
            ),
          );
        }
      },
    );
  }, [conversationId, currentUserId, otherUser.id, uploadFile, currentUser?.name, currentUser?.username, myAvatar, closeAllPanels]);

  // ─── جلب السجل التاريخي ──────────────────────────────────────────────────

  const loadHistory = useCallback(() => {
    const socket = getSocket();
    if (!socket) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const doEmit = () => {
      const timer = setTimeout(() => {
        setLoading(false);
      }, 5000);

      socket.emit("pm:history", { conversationId }, (res: any) => {
        clearTimeout(timer);
        if (res?.success && Array.isArray(res.messages)) {
          setMessages(
            res.messages.map((m: any) => ({
              ...m,
              pending: false,
              failed: false,
            })),
          );
        }
        setLoading(false);
      });
    };

    if (socket.connected) {
      doEmit();
    } else {
      socket.once("connect", doEmit);
      const connTimer = setTimeout(() => {
        socket.off("connect", doEmit);
        setLoading(false);
      }, 8000);
      socket.once("connect", () => clearTimeout(connTimer));
    }

    if (socket.connected) {
      socket.emit("pm:read", { conversationId });
    }
    setPmUnreadCount(0);
  }, [conversationId, setPmUnreadCount]);

  // ─── الاستماع لأحداث Socket ───────────────────────────────────────────────

  useEffect(() => {
    loadHistory();

    const socket = getSocket();
    if (!socket) return;

    const onMessage = (msg: PMMessage) => {
      if (msg.conversationId !== conversationId) return;
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id || (msg.clientId && m.clientId === msg.clientId))) {
          return prev;
        }
        return [...prev, { ...msg, pending: false, failed: false }];
      });
      socket.emit("pm:read", { conversationId });
    };

    const onTyping = (data: { fromUserId: string }) => {
      if (data.fromUserId === otherUser.id) {
        setIsTyping(true);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setIsTyping(false), 3000);
      }
    };

    const onStopTyping = (data: { fromUserId: string }) => {
      if (data.fromUserId === otherUser.id) {
        setIsTyping(false);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      }
    };

    const onPmRead = (data: { conversationId: string; readerId: string }) => {
      if (data.conversationId === conversationId && data.readerId === otherUser.id) {
        setMessages(prev => prev.map(m => m.senderId === currentUserId ? { ...m, read: true } : m));
      }
    };

    // تحديث التفاعل على الرسائل
    const onReaction = (data: { messageId: string; conversationId: string; reactions: Record<string, ReactionType> }) => {
      if (data.conversationId !== conversationId) return;
      setMessages(prev =>
        prev.map(m =>
          m.id === data.messageId ? { ...m, reactions: data.reactions } : m,
        ),
      );
    };

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    socket.on("pm:message", onMessage);
    socket.on("pm:typing", onTyping);
    socket.on("pm:stop_typing", onStopTyping);
    socket.on("pm:read", onPmRead);
    socket.on("pm:reaction", onReaction);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    setSocketConnected(socket.connected);

    // تحديث بيانات المستخدم الآخر عند تغيير البروفايل
    const onUserProfileUpdated = (data: any) => {
      if (!data?.userId || String(data.userId) !== String(otherUser.id)) return;
      setOtherUserData(prev => ({
        ...prev,
        name: data.username || prev.name,
        avatar: data.avatar || data.avatarUrl || prev.avatar,
      }));
    };
    socket.on("user_profile_updated", onUserProfileUpdated);

    return () => {
      socket.off("pm:message", onMessage);
      socket.off("pm:typing", onTyping);
      socket.off("pm:stop_typing", onStopTyping);
      socket.off("pm:read", onPmRead);
      socket.off("pm:reaction", onReaction);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("user_profile_updated", onUserProfileUpdated);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [conversationId, otherUser.id, loadHistory]);

  // ─── التمرير للأسفل ──────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ─── مؤشر الكتابة ────────────────────────────────────────────────────────

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
      const socket = getSocket();
      if (!socket?.connected) return;
      socket.emit("pm:typing", { toUserId: otherUser.id });
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        socket.emit("pm:stop_typing", { toUserId: otherUser.id });
      }, 2000);
    },
    [otherUser.id],
  );

  // ─── تنسيق الوقت ──────────────────────────────────────────────────────────

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  // ─── عرض التفاعل على رسالة ────────────────────────────────────────────────

  const renderReactions = (msg: PMMessage) => {
    const reactions = msg.reactions || {};
    const entries = Object.entries(reactions);
    if (entries.length === 0) return null;

    // تجميع العدد لكل نوع تفاعل
    const counts: Partial<Record<ReactionType, number>> = {};
    let myReaction: ReactionType | null = null;
    for (const [, reactionType] of entries) {
      counts[reactionType] = (counts[reactionType] || 0) + 1;
    }
    // التحقق من تفاعل المستخدم الحالي
    if (reactions[currentUserId]) {
      myReaction = reactions[currentUserId];
    }

    return (
      <div className={`flex flex-wrap gap-1 mt-1.5 ${msg.senderId === currentUserId ? "justify-start" : "justify-end"}`}>
        {(Object.entries(counts) as [ReactionType, number][]).map(([type, count]) => {
          const config = REACTIONS_CONFIG.find(r => r.type === type);
          if (!config) return null;
          const isMyReaction = myReaction === type;
          return (
            <button
              key={type}
              onClick={() => handleReact(msg.id, type)}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-all hover:scale-110 ${
                isMyReaction
                  ? "bg-primary/20 border border-primary/40 ring-1 ring-primary/20"
                  : "bg-muted hover:bg-muted/80 border border-transparent"
              }`}
              title={config.label}
            >
              <span className="text-sm leading-none">{config.emoji}</span>
              <span className={isMyReaction ? "text-primary" : "text-muted-foreground"}>{count}</span>
            </button>
          );
        })}
      </div>
    );
  };

  // ─── مكوّن اختيار التفاعل ─────────────────────────────────────────────────

  const renderReactionPicker = (msgId: string) => {
    if (activeReactionMsgId !== msgId) return null;

    return (
      <div
        ref={reactionPickerRef}
        className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="flex items-center gap-0.5 px-2 py-1.5 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-border animate-in fade-in zoom-in-95 duration-150">
          {REACTIONS_CONFIG.map(({ type, emoji, label }) => (
            <button
              key={type}
              onClick={() => handleReact(msgId, type)}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-all hover:scale-125 active:scale-95"
              title={label}
            >
              <span className="text-xl leading-none">{emoji}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ─── الانتقال إلى رسالة محددة ──────────────────────────────────────────────

  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`pm-msg-${messageId}`);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // إضافة تأثير التمييز
    el.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
    el.style.transition = "box-shadow 0.3s ease";

    setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
    }, 2000);
  }, []);

  // ─── مكوّن عرض الوسائط ───────────────────────────────────────────────────

  const renderMedia = (msg: PMMessage) => {
    if (!msg.mediaUrl) return null;

    if (msg.mediaType === "audio") {
      return (
        <div className="mb-1.5 overflow-hidden rounded-xl">
          <VoiceMessagePlayer src={msg.mediaUrl} />
        </div>
      );
    }

    if (msg.mediaType === "video") {
      return (
        <div className="mb-1.5 overflow-hidden rounded-xl">
          <video
            src={msg.mediaUrl}
            controls
            className="max-w-full max-h-[250px] rounded-xl object-cover"
            preload="metadata"
          />
        </div>
      );
    }

    return (
      <div className="mb-1.5 overflow-hidden rounded-xl">
        <img
          src={msg.mediaUrl}
          alt="صورة"
          className="max-w-full max-h-[250px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition"
          onClick={() => window.open(msg.mediaUrl, "_blank")}
          loading="lazy"
        />
      </div>
    );
  };

  // ─── تجميع الرسائل بالتاريخ ───────────────────────────────────────────────

  const groupedMessages = messages.reduce<{ date: string; msgs: PMMessage[] }[]>((acc, msg) => {
    const day = new Date(msg.createdAt).toLocaleDateString("ar-EG", {
      weekday: "long", day: "numeric", month: "long",
    });
    const last = acc[acc.length - 1];
    if (last && last.date === day) {
      last.msgs.push(msg);
    } else {
      acc.push({ date: day, msgs: [msg] });
    }
    return acc;
  }, []);

  // ─── الرندر ──────────────────────────────────────────────────────────────

  const canSend = (text.trim().length > 0 || !!pendingMedia || !!selectedVideo) && !sending && !uploading;

  // استخدام بيانات الأونلاين إذا كانت محدثة (أولوية أعلى)
  const onlineUser = onlineUsers.find(u => String(u.id) === String(otherUserData.id));
  const resolvedAvatar = onlineUser?.avatar || otherUserData.avatar || "/pic.png";
  const resolvedName = onlineUser?.username || onlineUser?.name || otherUserData.name;

  return (
    <div className="flex flex-col h-full" dir="rtl">

      {/* الهيدر */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white dark:bg-slate-900 shadow-sm">
        <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9 shrink-0" onClick={onBack}>
          <ArrowRight size={18} />
        </Button>
        <Avatar
          className="w-10 h-10 rounded-xl cursor-pointer transition hover:scale-105 shrink-0"
          onClick={() => onOpenProfile?.(otherUserData.id)}
        >
          <AvatarImage src={resolvedAvatar} />
          <AvatarFallback className="rounded-xl">{resolvedName?.[0]}</AvatarFallback>
        </Avatar>
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => onOpenProfile?.(otherUserData.id)}
        >
          <h4 className="font-black text-sm hover:underline truncate">{resolvedName}</h4>
          {isTyping ? (
            <p className="text-[10px] text-primary font-bold animate-pulse">يكتب...</p>
          ) : (
            <p className="text-[10px] text-muted-foreground font-medium">محادثة خاصة</p>
          )}
        </div>
        <div className="shrink-0" title={socketConnected ? "متصل" : "غير متصل"}>
          {socketConnected
            ? <Wifi size={14} className="text-green-500" />
            : <WifiOff size={14} className="text-red-400 animate-pulse" />
          }
        </div>
      </div>

      {/* مشغل يوتيوب المدمج */}
      {activeYouTubeEmbedUrl && (
        <div className="absolute top-[64px] inset-x-0 z-30 bg-black border-b border-slate-800 shadow-xl animate-in slide-in-from-top duration-300">
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

      {/* منطقة الرسائل */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 bg-slate-50 dark:bg-slate-950">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-primary" size={22} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Send size={24} className="text-primary" />
            </div>
            <p className="text-sm font-bold text-foreground">ابدأ المحادثة</p>
            <p className="text-[11px] text-muted-foreground mt-1">أرسل رسالة لبدء الدردشة مع {resolvedName}</p>
          </div>
        ) : (
          groupedMessages.map(group => (
            <div key={group.date}>
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[9px] font-bold text-muted-foreground px-2 py-0.5 bg-muted rounded-full">
                  {group.date}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <div className="space-y-2">
                {group.msgs.map(msg => {
                  const isMine = msg.senderId === currentUserId;
                  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;

                  return (
                    <div
                      key={msg.id}
                      id={`pm-msg-${msg.id}`}
                      className={`group/msg flex ${isMine ? "justify-start" : "justify-end"} items-end gap-2 relative transition-all duration-300`}
                    >
                      {isMine && (
                        <Avatar
                          className="w-7 h-7 rounded-lg shrink-0 cursor-pointer hover:scale-110 transition"
                          onClick={() => onOpenProfile?.(currentUserId)}
                        >
                          <AvatarImage src={myAvatar} />
                          <AvatarFallback className="text-[9px]">{currentUser?.name?.[0] || "أنا"}</AvatarFallback>
                        </Avatar>
                      )}

                      <div className="max-w-[75%] relative">
                        {/* أزرار التفاعل والرد - تظهر عند التحويم */}
                        {!msg.pending && !msg.failed && (
                          <div
                            className={`absolute top-1/2 -translate-y-1/2 z-40 flex flex-col gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${
                              isMine ? "-left-9" : "-right-9"
                            }`}
                          >
                            <button
                              onClick={() => setActiveReactionMsgId(activeReactionMsgId === msg.id ? null : msg.id)}
                              className="w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-border shadow-sm hover:bg-muted transition"
                              title="تفاعل"
                            >
                              <SmilePlus size={14} className="text-muted-foreground" />
                            </button>
                            <button
                              onClick={() => setReplyToMsg(msg)}
                              className="w-7 h-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-700 border border-border shadow-sm hover:bg-muted transition"
                              title="رد"
                            >
                              <Reply size={14} className="text-muted-foreground" />
                            </button>
                          </div>
                        )}

                        {/* قائمة اختيار التفاعل */}
                        {renderReactionPicker(msg.id)}

                        {/* فقاعة الرسالة */}
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm transition-all ${
                            isMine
                              ? msg.failed
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-br-sm"
                                : msg.pending
                                ? "bg-primary/60 text-white rounded-br-sm opacity-75"
                                : "bg-primary text-white rounded-br-sm"
                              : "bg-white dark:bg-slate-800 text-foreground rounded-bl-sm border border-border"
                          }`}
                        >
                          {/* اقتباس الرد */}
                          {msg.replyToId && (
                            <div
                              className={`mb-2 px-3 py-2 rounded-xl border-r-4 cursor-pointer hover:brightness-95 transition ${
                                isMine
                                  ? "bg-white/15 border-white/40"
                                  : "bg-muted/50 border-primary/40"
                              }`}
                              onClick={() => scrollToMessage(msg.replyToId!)}
                            >
                              <p className={`text-[9px] font-bold mb-0.5 ${isMine ? "text-white/80" : "text-primary"}`}>
                                {msg.replyToSenderName || "عضو"}
                              </p>
                              {msg.replyToMediaUrl && (
                                <div className="mb-0.5">
                                  {msg.replyToMediaType === "video" ? (
                                    <span className={`text-[9px] ${isMine ? "text-white/60" : "text-muted-foreground"}`}>🎥 فيديو</span>
                                  ) : (
                                    <img
                                      src={msg.replyToMediaUrl}
                                      alt=""
                                      className="h-10 w-10 rounded-lg object-cover"
                                    />
                                  )}
                                </div>
                              )}
                              {msg.replyToText && (
                                <p className={`text-[9px] truncate max-w-[200px] ${isMine ? "text-white/70" : "text-muted-foreground"}`}>
                                  {msg.replyToText}
                                </p>
                              )}
                            </div>
                          )}

                          {renderMedia(msg)}
                          {msg.text && <p dir="auto">{renderTextWithFaces(msg.text, msg.animatedFaces)}</p>}
                          {msg.text && findYouTubeLinks(msg.text).map((link) => (
                            <YouTubePreviewCard
                              key={link}
                              url={link}
                              onPlay={(embedUrl) => setActiveYouTubeEmbedUrl(embedUrl)}
                            />
                          ))}
                          <div className={`flex items-center gap-1.5 mt-1 ${isMine ? "justify-start" : "justify-end"}`}>
                            <span className={`text-[9px] ${isMine ? (msg.failed ? "text-red-400" : "text-white/60") : "text-muted-foreground"}`}>
                              {msg.failed
                                ? "فشل الإرسال ✕"
                                : msg.pending
                                ? "جارٍ الإرسال..."
                                : formatTime(msg.createdAt)}
                            </span>
                            {isMine && !msg.pending && !msg.failed && (
                              <span className="text-[10px] select-none font-bold">
                                {msg.read ? (
                                  <span className="text-blue-200 dark:text-blue-300" title="مقروءة">✓✓</span>
                                ) : (
                                  <span className="text-white/40" title="مستلمة">✓</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* عرض التفاعل */}
                        {hasReactions && renderReactions(msg)}
                      </div>

                      {!isMine && (
                        <Avatar
                          className="w-7 h-7 rounded-lg shrink-0 cursor-pointer hover:scale-110 transition"
                          onClick={() => onOpenProfile?.(otherUserData.id)}
                        >
                          <AvatarImage src={resolvedAvatar} />
                          <AvatarFallback className="text-[9px]">{resolvedName?.[0]}</AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {isTyping && (
          <div className="flex justify-end items-end gap-2">
            <Avatar className="w-7 h-7 rounded-lg shrink-0">
              <AvatarImage src={resolvedAvatar} />
              <AvatarFallback className="text-[9px]">{resolvedName?.[0]}</AvatarFallback>
            </Avatar>
            <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3 border border-border shadow-sm">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* شريط معاينة الرد */}
      {replyToMsg && (
        <div className="px-4 pt-2 border-t bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-xl border-r-4 border-primary">
            <Reply size={16} className="text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-primary">
                الرد على {replyToMsg.senderName || "عضو"}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {replyToMsg.text || (replyToMsg.mediaType === "video" ? "🎥 فيديو" : replyToMsg.mediaUrl ? "🖼️ صورة" : "...")}
              </p>
            </div>
            <button
              onClick={() => setReplyToMsg(null)}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-muted transition"
            >
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* معاينة الوسائط */}
      {pendingMedia && (
        <div className="px-4 pt-2 border-t bg-white dark:bg-slate-900">
          <div className="relative inline-block">
            {pendingMedia.type === "image" ? (
              <img
                src={pendingMedia.previewUrl}
                alt="معاينة"
                className="h-20 w-20 rounded-xl object-cover border-2 border-primary/30"
              />
            ) : (
              <video
                src={pendingMedia.previewUrl}
                className="h-20 w-20 rounded-xl object-cover border-2 border-primary/30"
                muted
              />
            )}
            <button
              onClick={handleRemoveMedia}
              className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition shadow"
            >
              <X size={12} />
            </button>
            {uploading && (
              <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center">
                <Loader2 className="animate-spin text-white" size={18} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* حقل الإدخال */}
      <div ref={inputAreaRef} className="flex flex-col border-t bg-white dark:bg-slate-900 shadow-sm relative">
        {/* معاينة الفيديو المختار من يوتيوب */}
        {selectedVideo && (
          <div className="px-4 pt-2 border-b bg-white dark:bg-slate-900">
            <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/50 rounded-xl border-r-4 border-red-500">
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
          <div className="p-3 border-b bg-white dark:bg-slate-900 animate-in slide-in-from-bottom duration-200">
            <YouTubeSearchInline
              onSelectVideo={(video) => setSelectedVideo(video)}
              selectedVideoId={selectedVideo?.id}
            />
          </div>
        )}

        {/* لوحة الإيموجي مدمجة */}
        <EmojiPanel
          onEmojiSelect={(emoji) => setText((prev) => prev + emoji)}
          search={emojiSearch}
          setSearch={setEmojiSearch}
          activeCategory={activeEmojiCat}
          setActiveCategory={setActiveEmojiCat}
          isOpen={showEmoji}
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

        {/* شريط التسجيل الصوتي */}
        {recorder.isRecording && (
          <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-red-50 dark:bg-red-950/20">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-red-600">{formatDuration(recorder.duration)}</span>
            <button type="button" onClick={recorder.isPaused ? recorder.resumeRecording : recorder.pauseRecording} className="text-xs font-bold text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition">
              {recorder.isPaused ? "استئناف" : "إيقاف مؤقت"}
            </button>
            <button type="button" onClick={recorder.stopRecording} className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-lg transition">
              إيقاف
            </button>
          </div>
        )}
        {recorder.audioBlob && !recorder.isRecording && (
          <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-muted/50">
            <audio src={recorder.audioUrl!} controls className="flex-1 h-8" />
            <button type="button" onClick={recorder.clearRecording} className="text-xs font-bold text-muted-foreground hover:text-red-600 px-2 py-1 rounded-lg hover:bg-muted transition">
              <X size={14} />
            </button>
            <button type="button" onClick={handleSendVoice} disabled={sending} className="text-xs font-bold text-white bg-primary hover:bg-primary/90 px-3 py-1 rounded-lg transition flex items-center gap-1">
              <Send size={12} /> إرسال
            </button>
          </div>
        )}

        <div className="flex gap-2 px-4 py-3 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`rounded-xl h-10 w-10 shrink-0 transition-colors ${menuOpen || showEmoji || showFaces || showStickers || showYouTubeSearch ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"}`}
                disabled={uploading || !socketConnected}
                title="أدوات المراسلة"
              >
                {(showEmoji || showFaces || showStickers || showYouTubeSearch) ? <X size={18} /> : <Plus size={18} />}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-auto p-2 mb-2 z-50">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted transition active:scale-90"
                  title="إرفاق صورة أو فيديو"
                >
                  <ImagePlus size={22} className="text-muted-foreground" />
                  <span className="text-[9px] font-bold">صورة</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    closeAllPanels();
                    setShowYouTubeSearch(true);
                  }}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-muted transition active:scale-90"
                  title="بحث YouTube"
                >
                  <Youtube size={22} className="text-red-500" />
                  <span className="text-[9px] font-bold">يوتيوب</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    closeAllPanels();
                    setShowStickers(true);
                  }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showStickers ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  title="ملصقات"
                >
                  <span className="text-[20px] leading-none">🖼️</span>
                  <span className="text-[9px] font-bold">ملصقات</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    closeAllPanels();
                    setShowFaces(true);
                  }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showFaces ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  title="فيسات متحركة"
                >
                  <Smile size={22} className="text-orange-500" />
                  <span className="text-[9px] font-bold">فيسات</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    closeAllPanels();
                    setShowEmoji(true);
                  }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${showEmoji ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  title="إيموجي"
                >
                  <SmilePlus size={22} className="text-yellow-500" />
                  <span className="text-[9px] font-bold">إيموجي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (recorder.isRecording) {
                      recorder.stopRecording();
                    } else {
                      recorder.startRecording();
                    }
                  }}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-90 ${recorder.isRecording ? "bg-red-500 text-white" : "hover:bg-muted"}`}
                  title={recorder.isRecording ? "إيقاف التسجيل" : "تسجيل صوتي"}
                >
                  {recorder.isRecording ? <MicOff size={22} /> : <Mic size={22} className="text-red-500" />}
                  <span className="text-[9px] font-bold">{recorder.isRecording ? "إيقاف" : "صوت"}</span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <Input
            placeholder="اكتب رسالة..."
            className="h-10 text-xs bg-slate-100 dark:bg-slate-800 border-none rounded-xl flex-1"
            value={text}
            onChange={handleInputChange}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && canSend && handleSend()}
            dir="rtl"
            maxLength={1000}
            disabled={!socketConnected}
          />
          <Button
            size="icon"
            className="rounded-xl h-10 w-10 shrink-0 shadow-md"
            onClick={handleSend}
            disabled={!canSend}
          >
            {(sending || uploading) ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PrivateChat;
