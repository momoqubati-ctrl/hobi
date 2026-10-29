import React, { useState, useRef, useEffect } from "react";
import { Maximize2, Mic, MicOff, PhoneOff } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CallUser } from "./callTypes";

interface MiniCallWidgetProps {
  user: CallUser;
  durationSeconds: number;
  isMuted: boolean;
  isSpeaking: boolean;
  onMaximize: () => void;
  onToggleMute: () => void;
  onEndCall: () => void;
}

export const MiniCallWidget: React.FC<MiniCallWidgetProps> = ({
  user,
  durationSeconds,
  isMuted,
  isSpeaking,
  onMaximize,
  onToggleMute,
  onEndCall,
}) => {
  const [position, setPosition] = useState({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // عدم تفعيل السحب إذا تم النقر على زر
    if ((e.target as HTMLElement).closest("button")) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position.x,
      initY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 300, dragRef.current.initX + dx)),
        y: Math.max(10, Math.min(window.innerHeight - 80, dragRef.current.initY + dy)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      className={`fixed z-[9995] flex items-center gap-3 p-2 pr-3 pl-2 rounded-full bg-white/95 dark:bg-slate-950/85 backdrop-blur-xl border border-cyan-500/30 dark:border-cyan-500/35 shadow-[0_10px_30px_rgba(0,0,0,0.15)] dark:shadow-[0_10px_35px_rgba(0,0,0,0.7),0_0_15px_rgba(6,182,212,0.25)] select-none cursor-move transition-shadow ${
        isDragging ? "shadow-cyan-500/40 ring-2 ring-cyan-500/50" : ""
      } animate-in zoom-in-95 duration-200`}
    >
      {/* الصورة مع مؤشر التحدث الدائري */}
      <div className="relative shrink-0">
        <div
          className={`w-10 h-10 rounded-full p-0.5 border ${
            isSpeaking ? "border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "border-cyan-500/40"
          }`}
        >
          <Avatar className="w-full h-full rounded-full">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="bg-slate-200 dark:bg-slate-800 text-xs text-slate-800 dark:text-white">
              {user.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* تفاصيل المتصل وعداد الوقت وموجات الصوت المصغرة */}
      <div className="flex flex-col min-w-0 pr-1">
        <span className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[100px]">{user.name}</span>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
          <span>{formatTime(durationSeconds)}</span>
          {/* 3 أعمدة مصغرة للصوت */}
          <div className="flex items-center gap-0.5 h-2.5">
            <span
              className={`w-0.5 bg-emerald-500 rounded-full transition-all duration-150 ${
                isSpeaking ? "h-3" : "h-1 opacity-50"
              }`}
            />
            <span
              className={`w-0.5 bg-emerald-500 rounded-full transition-all duration-150 ${
                isSpeaking ? "h-2" : "h-1 opacity-50"
              }`}
            />
            <span
              className={`w-0.5 bg-emerald-500 rounded-full transition-all duration-150 ${
                isSpeaking ? "h-3" : "h-1 opacity-50"
              }`}
            />
          </div>
        </div>
      </div>

      {/* أزرار التحكم المصغرة */}
      <div className="flex items-center gap-1 shrink-0 mr-1">
        {/* زر كتم سريع */}
        <button
          onClick={onToggleMute}
          className={`p-1.5 rounded-full transition-colors ${
            isMuted
              ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 hover:bg-rose-200"
              : "bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 hover:bg-slate-200 dark:hover:text-white dark:hover:bg-slate-700/80"
          }`}
          title={isMuted ? "إلغاء الكتم" : "كتم الصوت"}
        >
          {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        </button>

        {/* زر العودة للشاشة الكاملة */}
        <button
          onClick={onMaximize}
          className="p-1.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-300 hover:bg-slate-200 dark:hover:bg-slate-700/80 transition-colors"
          title="تكبير الشاشة"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        {/* زر إنهاء المكالمة */}
        <button
          onClick={onEndCall}
          className="p-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white transition-colors shadow-sm"
          title="إنهاء المكالمة"
        >
          <PhoneOff className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
export default MiniCallWidget;
