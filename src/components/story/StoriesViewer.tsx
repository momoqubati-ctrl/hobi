import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Heart, MessageCircle, Share2, Gift, Eye, Trash2, Loader2 } from "lucide-react";
import { useStoriesStore, getStoriesByUser, Story } from "@/lib/stories-store";
import { getSocket } from "@/lib/socket";
import ViewerOverlay from "./ViewerOverlay";

const STORY_DURATION_MS = 5000;

const StoriesViewer = () => {
  const {
    stories, isLoading, viewerOpen, viewerUserIndex, viewerStoryIndex,
    closeViewer, nextStory, prevStory, nextUser, prevUser, markViewed,
  } = useStoriesStore();

  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  const [likers, setLikers] = useState<any[]>([]);
  const [liked, setLiked] = useState(false);
  const progressRef = useRef<number>(0);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const socket = getSocket();

  const currentUser = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch { return null; }
  }, []);

  const userStories = getStoriesByUser(stories, viewerUserIndex);
  const currentStory: Story | undefined = userStories[viewerStoryIndex];
  const isOwner = currentStory ? currentUser?.id === currentStory.authorId : false;

  const resetProgress = useCallback(() => {
    setProgress(0);
    progressRef.current = 0;
    startTimeRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!viewerOpen || paused || !currentStory) return;
    resetProgress();
    startTimeRef.current = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(100, (elapsed / STORY_DURATION_MS) * 100);
      progressRef.current = pct;
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
  }, [viewerOpen, paused, currentStory?.id, viewerStoryIndex, viewerUserIndex]);

  useEffect(() => {
    setShowViewers(false);
    setViewers([]);
    setLikers([]);
    setPaused(false);
  }, [viewerOpen]);

  useEffect(() => {
    if (!currentStory || !viewerOpen) return;
    if (!currentStory.viewedByMe) {
      socket.emit("stories:view", { storyId: currentStory.id });
      markViewed(currentStory.id);
    }
    resetProgress();
    setLiked(currentStory?.likedByMe || false);
  }, [currentStory?.id, viewerOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!viewerOpen) return;
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowRight") nextStory();
      if (e.key === "ArrowLeft") prevStory();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [viewerOpen, nextStory, prevStory, closeViewer]);

  if (!viewerOpen || !currentStory) return null;

  const handleViewersClick = () => {
    setPaused(true);
    setViewers([]);
    setLikers([]);
    setShowViewers(true);
    socket.emit("stories:getViewers", { storyId: currentStory.id }, (res: any) => {
      if (res?.success) {
        setViewers(res.viewers || []);
      }
    });
    socket.emit("stories:getReactions", { storyId: currentStory.id, type: "like" }, (res: any) => {
      if (res?.success) {
        setLikers(res.reactions || []);
      }
    });
  };

  const handleLike = () => {
    socket.emit("stories:react", { storyId: currentStory.id, type: "like" });
    setLiked(!liked);
  };

  const handleReply = () => {
    closeViewer();
  };

  const handleShare = () => {
    socket.emit("stories:share", { storyId: currentStory.id });
    if (navigator.share && currentStory.linkUrl) {
      navigator.share({ url: currentStory.linkUrl }).catch(() => {});
    } else if (currentStory.linkUrl) {
      navigator.clipboard.writeText(currentStory.linkUrl).catch(() => {});
    }
  };

  const handleGift = () => {
    // فتح متجر الهدايا - يرتبط بـ GiftStore لاحقاً
  };

  const handleDelete = () => {
    if (window.confirm("هل أنت متأكد من حذف هذه القصة؟")) {
      socket.emit("stories:delete", { storyId: currentStory!.id });
      closeViewer();
    }
  };

  const isText = currentStory.mediaType === "text";
  const isVideo = currentStory.mediaType === "video";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95" dir="rtl">
      {/* Loading */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
          <p className="text-sm font-bold text-white/70">جاري تحميل القصص...</p>
        </div>
      )}

      {/* Close */}
      <button onClick={closeViewer} className="absolute left-4 top-4 z-20 rounded-full bg-black/40 p-2 text-white hover:bg-black/60">
        <X className="h-5 w-5" />
      </button>

      {/* Progress Bars */}
      <div className="absolute right-0 top-0 left-0 z-20 flex gap-1 p-2">
        {userStories.map((story, idx) => (
          <div key={story.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full rounded-full bg-white transition-all duration-100"
              style={{
                width: idx < viewerStoryIndex ? "100%" : idx === viewerStoryIndex ? `${progress}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Prev / Next tap zones */}
      <div className="absolute inset-0 z-10 flex">
        <div className="flex-1" onClick={prevStory} onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)} />
        <div className="flex-1" onClick={nextStory} onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)} />
      </div>

      {/* Story Content */}
      <div className="relative z-0 flex h-full w-full max-w-lg flex-col items-center justify-center">
        {isText ? (
          <div
            className="flex h-full w-full flex-col items-center justify-center p-8 text-center"
            style={{ background: currentStory.bgColor }}
          >
            {currentStory.caption && (
              <p className="text-2xl font-bold leading-relaxed" style={{ color: currentStory.textColor }}>
                {currentStory.caption}
              </p>
            )}
          </div>
        ) : isVideo ? (
          <div className="relative h-full w-full">
            <video
              src={currentStory.mediaUrl || ""}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
              controls
            />
            {currentStory.caption && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-6 pt-12">
                <p className="text-lg font-bold text-white text-center leading-relaxed">
                  {currentStory.caption}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="relative h-full w-full">
            <img
              src={currentStory.mediaUrl || ""}
              alt=""
              className="h-full w-full object-contain"
              onLoad={() => resetProgress()}
            />
            {currentStory.caption && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-6 pt-12">
                <p className="text-lg font-bold text-white text-center leading-relaxed">
                  {currentStory.caption}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Author Info */}
        <div className="absolute right-4 top-10 z-20 flex items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-full border-2 border-white/50">
            <img src={currentStory.authorAvatar || "/pic.png"} alt="" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">{currentStory.authorUsername}</p>
            <p className="text-[10px] text-white/60">
              {new Date(currentStory.createdAt).toLocaleString("ar")}
            </p>
          </div>
        </div>
      </div>

      {/* Left Side Actions (vertical) */}
      <div className="absolute left-2 top-1/2 z-20 -translate-y-1/2 flex flex-col items-center gap-4">
        {isOwner && (
          <button onClick={handleViewersClick} className="flex flex-col items-center gap-1 text-white/80 hover:text-white" title="المشاهدات">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-colors">
              <Eye className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold">{currentStory.viewCount}</span>
          </button>
        )}

        <button onClick={handleLike} className="flex flex-col items-center gap-1 text-white/80 hover:text-white" title="إعجاب">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-colors">
            <Heart className={`h-5 w-5 ${liked ? "fill-red-500 text-red-500" : ""}`} />
          </div>
          <span className="text-[10px] font-bold">{currentStory.likeCount + (liked ? 1 : 0)}</span>
        </button>

        <button onClick={handleReply} className="flex flex-col items-center gap-1 text-white/80 hover:text-white" title="رد">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-colors">
            <MessageCircle className="h-5 w-5" />
          </div>
          <span className="text-[10px] font-bold">رد</span>
        </button>

        <button onClick={handleShare} className="flex flex-col items-center gap-1 text-white/80 hover:text-white" title="مشاركة">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-colors">
            <Share2 className="h-5 w-5" />
          </div>
          <span className="text-[10px] font-bold">مشاركة</span>
        </button>

        <button onClick={handleGift} className="flex flex-col items-center gap-1 text-white/80 hover:text-white" title="هدية">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-colors">
            <Gift className="h-5 w-5" />
          </div>
          <span className="text-[10px] font-bold">هدية</span>
        </button>

        {isOwner && (
          <button onClick={handleDelete} className="flex flex-col items-center gap-1 text-red-400 hover:text-red-300" title="حذف">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md hover:bg-white/20 transition-colors">
              <Trash2 className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold">حذف</span>
          </button>
        )}
      </div>

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
