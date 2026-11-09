"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  getGlobalVideoElement,
  getGlobalVideoState,
  subscribeToGlobalMedia,
  attachVideoTo,
  pauseMedia,
  resumeMedia,
  seekMedia,
  closeMedia,
} from "@/lib/global-media";
import { Pause, Play, X, Maximize2, Minimize2, GripVertical } from "lucide-react";

interface GlobalVideoPlayerProps {
  activeTab: string;
  onExpandToWall?: () => void;
}

const GlobalVideoPlayer = ({ activeTab, onExpandToWall }: GlobalVideoPlayerProps) => {
  const floatingRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(getGlobalVideoState());
  const [isMinimized, setIsMinimized] = useState(false);
  const isDraggingRef = useRef(false);
  const [position, setPosition] = useState({ x: 16, y: 120 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    // debounce: نتجنب إعادة الرسم عند كل حدث resize
    let resizeTimer: ReturnType<typeof setTimeout>;
    const debouncedCheck = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(check, 100);
    };
    window.addEventListener("resize", debouncedCheck);
    return () => {
      window.removeEventListener("resize", debouncedCheck);
      clearTimeout(resizeTimer);
    };
  }, []);

  useEffect(() => {
    return subscribeToGlobalMedia(() => {
      setState(getGlobalVideoState());
    });
  }, []);

  // Always attach video to the right container - this effect MUST run even on wall tab
  useEffect(() => {
    const video = getGlobalVideoElement();
    if (!video || !state.url) return;

    if (activeTab === "wall") {
      const wallSlot = document.getElementById("global-video-wall-slot");
      if (wallSlot) {
        attachVideoTo(wallSlot);
      }
    } else if (floatingRef.current) {
      attachVideoTo(floatingRef.current);
    }
  }, [activeTab, state.url, state.isPlaying]);

  // Also re-attach when state changes and we're on wall tab (in case slot appeared after render)
  useEffect(() => {
    if (activeTab !== "wall" || !state.url) return;
    // Small delay to ensure DOM is ready
    const t = setTimeout(() => {
      const video = getGlobalVideoElement();
      const wallSlot = document.getElementById("global-video-wall-slot");
      if (video && wallSlot) {
        attachVideoTo(wallSlot);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [state.url, state.isPlaying, activeTab]);

  const togglePlay = useCallback(() => {
    if (getGlobalVideoState().isPlaying) {
      pauseMedia();
    } else {
      resumeMedia();
    }
  }, []);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    seekMedia(parseFloat(e.target.value));
  }, []);

  const close = useCallback(() => {
    closeMedia();
    setIsMinimized(false);
  }, []);

  const expandToWall = useCallback(() => {
    onExpandToWall?.();
  }, [onExpandToWall]);

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    isDraggingRef.current = true;
    document.body.style.userSelect = "none";
  }, []);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const w = isMobile ? 180 : 260;
    const h = isMobile ? 140 : 190;
    const newX = Math.max(0, Math.min(window.innerWidth - w, clientX - w / 2));
    const newY = Math.max(0, Math.min(window.innerHeight - h, clientY - h / 2));
    setPosition({ x: newX, y: newY });
  }, [isMobile]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.userSelect = "";
  }, []);

  // Mouse events
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMinimized) return;
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);

    const onMouseMove = (ev: MouseEvent) => handleDragMove(ev.clientX, ev.clientY);
    const onMouseUp = () => { handleDragEnd(); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [isMinimized, handleDragStart, handleDragMove, handleDragEnd]);

  // Touch events
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isMinimized) return;
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  }, [isMinimized, handleDragStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragMove(touch.clientX, touch.clientY);
  }, [handleDragMove]);

  const onTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  if (!state.url || activeTab === "wall") return null;

  const playerWidth = isMinimized ? 52 : isMobile ? 180 : 260;
  const playerHeight = isMinimized ? 52 : isMobile ? 140 : 190;

  return (
    <div
      className="fixed z-[9999] bg-black rounded-xl shadow-2xl overflow-hidden border border-white/20"
      style={{
        left: position.x,
        top: position.y,
        width: playerWidth,
        height: playerHeight,
        transition: isDraggingRef.current ? "none" : "width 0.2s ease, height 0.2s ease",
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {isMinimized ? (
        <button
          onClick={() => setIsMinimized(false)}
          className="w-full h-full flex items-center justify-center bg-primary/90 hover:bg-primary transition-colors rounded-xl"
        >
          <Play size={isMobile ? 24 : 20} className="text-white" fill="white" />
        </button>
      ) : (
        <>
          {/* Drag handle */}
          <div className="absolute top-0 left-0 right-0 h-6 bg-black/40 flex items-center justify-center cursor-grab active:cursor-grabbing z-10">
            <GripVertical size={14} className="text-white/50" />
          </div>

          {/* Video container */}
          <div
            ref={floatingRef}
            className="w-full bg-black"
            style={{ height: `calc(100% - ${isMobile ? 60 : 48}px)` }}
          />

          {/* Controls */}
          <div className="absolute bottom-0 left-0 right-0 bg-black/90 px-2 py-1.5">
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); togglePlay(); }}
                className="p-1.5 rounded-full bg-white/20 active:bg-white/30 transition-colors flex-shrink-0"
              >
                {state.isPlaying ? (
                  <Pause size={isMobile ? 16 : 12} className="text-white" />
                ) : (
                  <Play size={isMobile ? 16 : 12} className="text-white" fill="white" />
                )}
              </button>

              <span className="text-[10px] text-white/70 font-mono min-w-[32px] flex-shrink-0">
                {formatTime(state.currentTime)}
              </span>

              <input
                type="range"
                min="0"
                max={state.duration || 0}
                value={state.currentTime}
                onChange={seek}
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="flex-1 h-1 md:h-0.5 accent-primary cursor-pointer"
              />

              <span className="text-[10px] text-white/70 font-mono min-w-[32px] flex-shrink-0">
                {formatTime(state.duration)}
              </span>
            </div>

            <div className="flex items-center justify-end gap-1 mt-1">
              <button
                onClick={(e) => { e.stopPropagation(); expandToWall(); }}
                onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); expandToWall(); }}
                className="p-1.5 rounded-full bg-white/10 active:bg-white/20 transition-colors"
                title="العودة للحائط"
              >
                <Maximize2 size={isMobile ? 14 : 10} className="text-white/70" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setIsMinimized(true); }}
                onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setIsMinimized(true); }}
                className="p-1.5 rounded-full bg-white/10 active:bg-white/20 transition-colors"
                title="تصغير"
              >
                <Minimize2 size={isMobile ? 14 : 10} className="text-white/70" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); close(); }}
                onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); close(); }}
                className="p-1.5 rounded-full bg-white/10 active:bg-red-500/30 transition-colors"
                title="إغلاق"
              >
                <X size={isMobile ? 14 : 10} className="text-white/70" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GlobalVideoPlayer;
