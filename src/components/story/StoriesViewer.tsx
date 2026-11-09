import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Heart, MessageCircle, Share2, Gift, Eye, Trash2, Loader2, Volume2, VolumeX, ExternalLink, Plus } from "lucide-react";
import { useStoriesStore, getStoriesByUser, Story } from "@/lib/stories-store";
import { getSocket } from "@/lib/socket";
import ViewerOverlay from "./ViewerOverlay";
import { PermissionGate } from "@/components/ui/PermissionGate";

const IMAGE_STORY_DURATION_MS = 5000;

const StoriesViewer = () => {
  const {
    stories, isLoading, viewerOpen, viewerUserIndex, viewerStoryIndex,
    closeViewer, nextStory, prevStory, nextUser, prevUser, markViewed,
    markReacted, markFollowed,
  } = useStoriesStore();

  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  const [likers, setLikers] = useState<any[]>([]);
  const [liked, setLiked] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);
  const pressStartTimeRef = useRef<number>(0);
  const lastProgressUpdateRef = useRef<number>(0);

  const socket = getSocket();

  const currentUser = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch { return null; }
  }, []);

  const userStories = getStoriesByUser(stories, viewerUserIndex);
  const currentStory: Story | undefined = userStories[viewerStoryIndex];
  const isOwner = currentStory ? String(currentUser?.id) === String(currentStory.authorId) : false;

  const isVideo = currentStory?.mediaType === "video";
  const isText = currentStory?.mediaType === "text";

  // إبراء العداد وتهيئته
  const resetProgress = useCallback(() => {
    setProgress(0);
    elapsedBeforePauseRef.current = 0;
    startTimeRef.current = Date.now();
  }, []);

  // عند فتح قصة جديدة
  useEffect(() => {
    if (!currentStory || !viewerOpen) return;

    resetProgress();
    setPaused(false);
    setLoadError(false);
    setLiked(Boolean(currentStory.likedByMe));

    // بالنسبة للنصوص، المحتوى جاهز فوراً
    if (isText) {
      setMediaLoaded(true);
    } else {
      setMediaLoaded(false);
    }

    // تسجيل المشاهدة
    if (!currentStory.viewedByMe) {
      socket.emit("stories:view", {
        storyId: currentStory.id,
        viewerId: currentUser?.id ? String(currentUser.id) : undefined,
      });
      markViewed(currentStory.id);
    }

    // مهلة أمان قصوى لشاشة التحميل لمنع أي تعليق نهائياً على الهواتف
    const safetyTimer = setTimeout(() => {
      setMediaLoaded(true);
    }, 3500);

    return () => clearTimeout(safetyTimer);
  }, [currentStory?.id, viewerOpen, isText]);

  // إدارة مؤقت الصور والنصوص (Timer-based)
  useEffect(() => {
    if (!viewerOpen || isVideo || !currentStory || !mediaLoaded) return;

    if (paused) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    startTimeRef.current = Date.now() - elapsedBeforePauseRef.current;

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      elapsedBeforePauseRef.current = elapsed;
      const pct = Math.min(100, (elapsed / IMAGE_STORY_DURATION_MS) * 100);
      setProgress(pct);

      if (pct >= 100) {
        if (viewerStoryIndex < userStories.length - 1) {
          nextStory();
        } else {
          nextUser();
        }
        return;
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [viewerOpen, isVideo, paused, currentStory?.id, mediaLoaded, viewerStoryIndex, userStories.length]);

  // إدارة تشغيل الفيديو وتحديث التقدم المتزامن لحظياً (Video Frame Sync) مع ضبط وتخفيف إعادة الرسم (Throttling)
  const handleVideoTimeUpdate = () => {
    if (!videoRef.current || !isVideo) return;
    const v = videoRef.current;
    if (!mediaLoaded) setMediaLoaded(true);

    const now = Date.now();
    // تقليل إعادة رسم React على الشاشات الحديثة (120Hz) لمنع تعليق معالج الرسوميات
    if (now - lastProgressUpdateRef.current < 65) return;
    lastProgressUpdateRef.current = now;

    if (v.duration && isFinite(v.duration) && v.duration > 0) {
      const pct = Math.min(100, (v.currentTime / v.duration) * 100);
      setProgress(pct);
    }
  };

  const handleVideoEnded = () => {
    if (viewerStoryIndex < userStories.length - 1) {
      nextStory();
    } else {
      nextUser();
    }
  };

  // تشغيل وإيقاف الفيديو فوراً عند ظهوره أو تغيير حالة Pause مع دعم متصفحات الهواتف
  useEffect(() => {
    if (!videoRef.current || !isVideo || !viewerOpen) return;
    const v = videoRef.current;

    if (paused) {
      v.pause();
    } else {
      const p = v.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.warn("[StoriesViewer] Video play prevented, muting for mobile autoplay policy:", err);
          if (videoRef.current) {
            videoRef.current.muted = true;
            setIsMuted(true);
            videoRef.current.play().catch(() => {});
          }
        });
      }
    }
  }, [paused, isVideo, viewerOpen, currentStory?.id]);

  // تحديث بيانات المشاهدين والمعجبين لحظياً
  useEffect(() => {
    if (!viewerOpen) return;

    const onUserProfileUpdated = (data: any) => {
      if (!data?.userId) return;
      const newAvatar = data.avatar || data.avatarUrl;
      const newUsername = data.username;

      setViewers((prev) =>
        prev.map((v) =>
          String(v.id) === String(data.userId)
            ? { ...v, username: newUsername || v.username, avatar: newAvatar || v.avatar }
            : v
        )
      );

      setLikers((prev) =>
        prev.map((l) =>
          String(l.id) === String(data.userId)
            ? { ...l, username: newUsername || l.username, avatar: newAvatar || l.avatar }
            : l
        )
      );
    };

    socket.on("user_profile_updated", onUserProfileUpdated);
    return () => {
      socket.off("user_profile_updated", onUserProfileUpdated);
    };
  }, [viewerOpen, socket]);

  // اختصارات لوحة المفاتيح
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!viewerOpen) return;
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowLeft") nextStory(); // في الواجهات العربية RTL: اليسار هو التالي
      if (e.key === "ArrowRight") prevStory(); // اليمين هو السابق
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === "m" || e.key === "M") {
        setIsMuted((m) => !m);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [viewerOpen, nextStory, prevStory, closeViewer]);

  if (!viewerOpen || !currentStory) return null;

  // الضغط المطول للإيقاف المؤقت بدون تخطي القصة بالخطأ (Hold-to-Pause UX)
  const handlePointerDown = () => {
    pressStartTimeRef.current = Date.now();
    setPaused(true);
  };

  const handlePointerUp = (direction: "next" | "prev") => {
    const pressDuration = Date.now() - pressStartTimeRef.current;
    setPaused(false);

    // إذا كان النقر سريعاً (أقل من 220ms) نعتبره تنقلاً، وإذا كان مطولاً نعتبره إيقافاً مؤقتاً فقط
    if (pressDuration < 220) {
      if (direction === "next") {
        if (viewerStoryIndex < userStories.length - 1) nextStory();
        else nextUser();
      } else {
        prevStory();
      }
    }
  };

  const handleViewersClick = () => {
    setPaused(true);
    setViewers([]);
    setLikers([]);
    setShowViewers(true);
    socket.emit("stories:getViewers", { storyId: currentStory.id }, (res: any) => {
      if (res?.success) setViewers(res.viewers || []);
    });
    socket.emit("stories:getReactions", { storyId: currentStory.id, type: "like" }, (res: any) => {
      if (res?.success) setLikers(res.reactions || []);
    });
  };

  const handleLike = () => {
    if (!currentStory) return;
    const nextLiked = !currentStory.likedByMe;
    markReacted(currentStory.id, "like", nextLiked, true);
    socket.emit("stories:react", { storyId: currentStory.id, type: "like" });
  };

  const handleFollowAuthor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser || isOwner || followingLoading || !currentStory) return;
    setFollowingLoading(true);
    socket.emit("profile:follow", { profileId: currentStory.authorId }, (res: any) => {
      setFollowingLoading(false);
      if (res?.success) {
        markFollowed(currentStory.authorId, Boolean(res.following));
      }
    });
  };

  const handleShare = () => {
    socket.emit("stories:share", { storyId: currentStory.id });
    const shareUrl = window.location.origin + `/dashboard?story=${currentStory.id}`;
    if (navigator.share) {
      navigator.share({ title: `قصة ${currentStory.authorUsername}`, url: shareUrl }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(shareUrl).catch(() => {});
    }
  };

  const handleDelete = () => {
    if (window.confirm("هل تريد بالتأكيد حذف هذه القصة؟")) {
      socket.emit("stories:delete", { storyId: currentStory.id });
      closeViewer();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 select-none" dir="rtl">
      {/* Loading Overlay */}
      {(!mediaLoaded && !isText) && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/60">
          <Loader2 className="h-10 w-10 animate-spin text-white/80" />
          <p className="text-xs font-bold text-white/70">جاري تحميل الوسائط...</p>
        </div>
      )}

      {/* Story Progress Bars */}
      <div className="absolute top-2.5 inset-x-3 z-40 flex gap-1.5 px-1">
        {userStories.map((story, idx) => (
          <div key={story.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className={`h-full rounded-full bg-white ${idx === viewerStoryIndex ? (isVideo ? "transition-none" : "transition-all duration-75") : "transition-none"}`}
              style={{
                width: idx < viewerStoryIndex ? "100%" : idx === viewerStoryIndex ? `${progress}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Header Bar Controls with clean padding below progress line */}
      <div className="absolute top-8 inset-x-4 z-40 flex items-center justify-between pointer-events-none pt-1">
        {/* Author Details */}
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="relative">
            <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-white/60 shadow-lg">
              <img src={currentStory.authorAvatar || "/pic.png"} alt="" className="h-full w-full object-cover" />
            </div>
            {/* زر متابعة (+) فوق/بجانب صورة البروفايل */}
            {!isOwner && currentUser && !currentStory.followedByMe && (
              <PermissionGate requiredPermissions={["story_interactions.use"]}>
              <button
                type="button"
                onClick={handleFollowAuthor}
                disabled={followingLoading}
                className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white shadow-md hover:scale-110 active:scale-95 transition-transform border border-white/80"
                title="متابعة"
              >
                {followingLoading ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Plus className="h-2.5 w-2.5 stroke-[3]" />
                )}
              </button>
              </PermissionGate>
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-white drop-shadow-md" style={currentStory.authorNameColor && currentStory.authorNameColor !== "#000000" ? { color: currentStory.authorNameColor } : undefined}>
              {currentStory.authorUsername}
            </p>
            <p className="text-[10px] text-white/70 drop-shadow">
              {new Date(currentStory.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>

        {/* Top Right Buttons */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {isVideo && (
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors border border-white/10"
              title={isMuted ? "تشغيل الصوت" : "كتم الصوت"}
            >
              {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          )}
          <button
            onClick={closeViewer}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors border border-white/10"
            title="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Tap Zones for Navigation (RTL: Left=Next, Right=Prev) */}
      <div className="absolute inset-0 z-10 flex">
        {/* Right side: Previous Story */}
        <div
          className="w-1/2 h-full cursor-pointer"
          onPointerDown={handlePointerDown}
          onPointerUp={() => handlePointerUp("prev")}
        />
        {/* Left side: Next Story */}
        <div
          className="w-1/2 h-full cursor-pointer"
          onPointerDown={handlePointerDown}
          onPointerUp={() => handlePointerUp("next")}
        />
      </div>

      {/* Story Content Area */}
      <div className="relative z-0 flex h-full w-full max-w-lg flex-col items-center justify-center overflow-hidden">
        {isText ? (
          <div
            className="flex h-full w-full flex-col items-center justify-center p-8 text-center"
            style={{ background: currentStory.bgColor }}
          >
            {currentStory.caption && (
              <p className="text-2xl font-black leading-relaxed select-text" style={{ color: currentStory.textColor }}>
                {currentStory.caption}
              </p>
            )}
          </div>
        ) : isVideo ? (
          <div className="relative h-full w-full flex items-center justify-center bg-black">
            <video
              key={currentStory.id}
              ref={videoRef}
              src={currentStory.mediaUrl || ""}
              className="h-full w-full object-contain"
              playsInline
              webkit-playsinline="true"
              x5-playsinline="true"
              x5-video-player-type="h5-page"
              autoPlay
              preload="auto"
              muted={isMuted}
              disableRemotePlayback={true}
              disablePictureInPicture={true}
              onLoadedMetadata={() => setMediaLoaded(true)}
              onLoadedData={() => setMediaLoaded(true)}
              onCanPlay={() => {
                setMediaLoaded(true);
                if (!paused) videoRef.current?.play().catch(() => {});
              }}
              onPlaying={() => setMediaLoaded(true)}
              onTimeUpdate={handleVideoTimeUpdate}
              onEnded={handleVideoEnded}
              onError={(e) => {
                console.warn("[StoriesViewer] Video load error:", e);
                setMediaLoaded(true);
                setLoadError(true);
              }}
            />
            {loadError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
                <p className="text-sm font-bold text-white/90">تعذر تشغيل هذا المقطع</p>
                <button
                  onClick={() => {
                    if (viewerStoryIndex < userStories.length - 1) nextStory();
                    else nextUser();
                  }}
                  className="rounded-xl bg-white/20 px-4 py-2 text-xs font-bold text-white hover:bg-white/30 border border-white/10"
                >
                  الانتقال للقصة التالية
                </button>
              </div>
            )}
            {currentStory.caption && (
              <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 pt-16 pointer-events-none">
                <p className="text-base font-bold text-white text-center leading-relaxed drop-shadow">
                  {currentStory.caption}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="relative h-full w-full flex items-center justify-center bg-black">
            <img
              key={currentStory.id}
              src={currentStory.mediaUrl || ""}
              alt=""
              className="h-full w-full object-contain"
              onLoad={() => setMediaLoaded(true)}
              onError={() => {
                setMediaLoaded(true);
                setLoadError(true);
              }}
            />
            {loadError && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
                <p className="text-sm font-bold text-white/90">تعذر عرض هذه الصورة</p>
                <button
                  onClick={() => {
                    if (viewerStoryIndex < userStories.length - 1) nextStory();
                    else nextUser();
                  }}
                  className="rounded-xl bg-white/20 px-4 py-2 text-xs font-bold text-white hover:bg-white/30 border border-white/10"
                >
                  الانتقال للقصة التالية
                </button>
              </div>
            )}
            {currentStory.caption && (
              <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 pt-16 pointer-events-none">
                <p className="text-base font-bold text-white text-center leading-relaxed drop-shadow">
                  {currentStory.caption}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Side Action Buttons (Floating vertical on left) */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-4">
        {isOwner && (
          <button onClick={handleViewersClick} className="flex flex-col items-center gap-1 text-white/90 hover:text-white group" title="المشاهدات">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 group-hover:bg-white/20 transition-all border border-white/10">
              <Eye className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold">{currentStory.viewCount}</span>
          </button>
        )}

        <PermissionGate requiredPermissions={["story_interactions.use"]}>
          <button onClick={handleLike} className="flex flex-col items-center gap-1 text-white/90 hover:text-white group" title="إعجاب">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 group-hover:bg-white/20 transition-all border border-white/10">
              <Heart className={`h-5 w-5 transition-transform active:scale-125 ${currentStory.likedByMe ? "fill-red-500 text-red-500" : ""}`} />
            </div>
            <span className="text-[10px] font-bold">{currentStory.likeCount}</span>
          </button>
        </PermissionGate>

        <PermissionGate requiredPermissions={["story_interactions.use"]}>
          <button onClick={handleShare} className="flex flex-col items-center gap-1 text-white/90 hover:text-white group" title="مشاركة">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 group-hover:bg-white/20 transition-all border border-white/10">
              <Share2 className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold">مشاركة</span>
          </button>
        </PermissionGate>

        {isOwner && (
          <PermissionGate requiredPermissions={["story_publish.use"]}>
          <button onClick={handleDelete} className="flex flex-col items-center gap-1 text-red-400 hover:text-red-300 group" title="حذف القصة">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 group-hover:bg-red-500/20 transition-all border border-red-500/20">
              <Trash2 className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold">حذف</span>
          </button>
          </PermissionGate>
        )}
      </div>

      {/* Viewers & Likers Modal */}
      {showViewers && (
        <ViewerOverlay
          viewers={viewers}
          likers={likers}
          onClose={() => { setShowViewers(false); setPaused(false); }}
        />
      )}
    </div>
  );
};

export default StoriesViewer;
