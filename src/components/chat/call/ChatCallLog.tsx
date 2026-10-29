import React from "react";
import { Phone, PhoneMissed, PhoneOff, ArrowUpRight, RotateCcw } from "lucide-react";
import { CallLogMessage } from "./callTypes";

interface ChatCallLogProps {
  log: CallLogMessage;
  onCallBack?: (callerId: string) => void;
  formatDuration?: (sec: number) => string;
}

export const ChatCallLog: React.FC<ChatCallLogProps> = ({
  log,
  onCallBack,
  formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  },
}) => {
  const isMissed = log.type === "missed";
  const isCompleted = log.type === "completed";
  const isBusy = log.type === "busy" || log.type === "rejected";

  return (
    <div className="flex items-center justify-center my-1.5 w-full select-none animate-in fade-in zoom-in-95 duration-200">
      <div
        className={`relative group max-w-[280px] w-full mx-auto rounded-xl px-2.5 py-2 backdrop-blur-xl border transition-all duration-300 shadow-sm hover:shadow-md ${
          isMissed
            ? "bg-white/90 dark:bg-slate-950/90 border-rose-200 dark:border-rose-500/35 hover:border-rose-400 dark:hover:border-rose-400/50 shadow-rose-500/5 dark:shadow-rose-950/20"
            : isCompleted
            ? "bg-white/90 dark:bg-slate-950/90 border-emerald-200 dark:border-emerald-500/35 hover:border-emerald-400 dark:hover:border-emerald-400/50 shadow-emerald-500/5 dark:shadow-emerald-950/20"
            : "bg-white/90 dark:bg-slate-950/90 border-amber-200 dark:border-amber-500/35 hover:border-amber-400 dark:hover:border-amber-400/50 shadow-amber-500/5 dark:shadow-amber-950/20"
        }`}
      >
        {/* شريط توهج لوني جانبي مصغر وأنيق */}
        <div
          className={`absolute right-0 top-2 bottom-2 w-0.5 rounded-l-full ${
            isMissed
              ? "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]"
              : isCompleted
              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
              : "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]"
          }`}
        />

        <div className="flex items-center justify-between gap-2 pr-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {/* أيقونة مصغرة مدمجة تدعم الوضعين الفاتح والداكن */}
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 shadow-inner ${
                isMissed
                  ? "bg-rose-50 dark:bg-rose-500/20 border-rose-200 dark:border-rose-500/40 text-rose-600 dark:text-rose-400"
                  : isCompleted
                  ? "bg-emerald-50 dark:bg-emerald-500/20 border-emerald-200 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-50 dark:bg-amber-500/20 border-amber-200 dark:border-amber-500/40 text-amber-600 dark:text-amber-400"
              }`}
            >
              {isMissed && <PhoneMissed className="w-3.5 h-3.5 animate-pulse" />}
              {isCompleted && <Phone className="w-3.5 h-3.5" />}
              {isBusy && <PhoneOff className="w-3.5 h-3.5" />}
            </div>

            {/* تفاصيل الرسالة بحجم متناسق وألوان واضحة في كلا الوضعين */}
            <div className="text-right truncate">
              <h5
                className={`text-xs font-bold tracking-tight truncate ${
                  isMissed
                    ? "text-rose-700 dark:text-rose-100"
                    : isCompleted
                    ? "text-emerald-700 dark:text-emerald-100"
                    : "text-amber-700 dark:text-amber-100"
                }`}
              >
                {isMissed && "مكالمة صوتية فائتة"}
                {isCompleted && "مكالمة صوتية مكتملة"}
                {log.type === "rejected" && "تم رفض المكالمة"}
                {log.type === "busy" && "مشغول بمكالمة أخرى"}
              </h5>
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                {isCompleted && (
                  <span className="font-mono text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-200 dark:border-emerald-500/30">
                    {formatDuration(log.durationSeconds || 0)}
                  </span>
                )}
                <span className="text-slate-500 dark:text-slate-400 font-medium">{log.timestamp}</span>
              </div>
            </div>
          </div>

          {/* زر إعادة الاتصال بحجم مضغوط ومتناسق */}
          {isMissed && onCallBack && (
            <button
              onClick={() => onCallBack(log.callerId)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 dark:bg-gradient-to-r dark:from-rose-600 dark:to-red-600 dark:hover:from-rose-500 dark:hover:to-red-500 text-white text-[11px] font-bold shadow-sm transition-all duration-200 active:scale-95 border border-rose-400/30 shrink-0"
              title="معاودة الاتصال"
            >
              <RotateCcw className="w-3 h-3" />
              <span>معاودة</span>
            </button>
          )}

          {isCompleted && (
            <div className="text-emerald-600 dark:text-emerald-400/70 pl-0.5 shrink-0">
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default ChatCallLog;
