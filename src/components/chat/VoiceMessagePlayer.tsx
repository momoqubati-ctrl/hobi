import React, { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";

interface VoiceMessagePlayerProps {
  src: string;
  className?: string;
}

const VoiceMessagePlayer = React.memo(({ src, className = "" }: VoiceMessagePlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bars] = useState(() => Array.from({ length: 32 }, () => 30 + Math.random() * 70));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) {
        setDuration(d);
        setIsLoaded(true);
      }
    };
    const onDurationChange = () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) {
        setDuration(d);
        setIsLoaded(true);
      }
    };
    const onTimeUpdate = () => {
      const t = audio.currentTime;
      if (isFinite(t)) setCurrentTime(t);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }, [isPlaying]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = pct * duration;
  }, [duration]);

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progress = duration > 0 && isFinite(duration) && isFinite(currentTime)
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  return (
    <div className={`flex items-center gap-2.5 ${className}`} dir="ltr">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* زر التشغيل */}
      <button
        onClick={togglePlay}
        className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white flex items-center justify-center transition-all duration-200 shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/30 active:scale-95"
      >
        {isPlaying ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" className="ms-0.5" />}
      </button>

      {/* شريط التقدم مع الموجات */}
      <div className="flex-1 min-w-0">
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          className="relative h-10 flex items-center cursor-pointer group"
        >
          {/* خلفية الموجات */}
          <div className="absolute inset-0 flex items-center gap-[2px]">
            {bars.map((h, i) => {
              const barProgress = (i / bars.length) * 100;
              const isActive = barProgress <= progress;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-full transition-all duration-150"
                  style={{
                    height: `${h * 0.35}%`,
                    minHeight: 3,
                    maxHeight: 14,
                    backgroundColor: isActive
                      ? "hsl(221.2, 83.2%, 53.3%)"
                      : "hsl(214.3, 31.8%, 91.4%)",
                    opacity: isActive ? 1 : 0.5,
                  }}
                />
              );
            })}
          </div>

          {/* خط التقدم فوق الموجات */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* الوقت */}
        <div className="flex justify-between mt-0.5 px-0.5">
          <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
            {formatTime(currentTime)}
          </span>
          <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
            {isLoaded ? formatTime(duration) : "0:00"}
          </span>
        </div>
      </div>
    </div>
  );
});

VoiceMessagePlayer.displayName = "VoiceMessagePlayer";
export default VoiceMessagePlayer;
