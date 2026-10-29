import React from "react";
import { Phone, PhoneCall, PhoneIncoming, PhoneOff, Minimize2, Radio, Activity } from "lucide-react";
import { CallState } from "./callTypes";

interface DevCallStateSwitcherProps {
  currentState: CallState;
  onStateChange: (state: CallState) => void;
  isSpeaking: boolean;
  onToggleSpeaking: () => void;
}

export const DevCallStateSwitcher: React.FC<DevCallStateSwitcherProps> = ({
  currentState,
  onStateChange,
  isSpeaking,
  onToggleSpeaking,
}) => {
  return (
    <div className="fixed bottom-4 left-4 z-[10000] flex flex-col gap-2 p-2.5 rounded-2xl bg-slate-950/90 backdrop-blur-md border border-cyan-500/40 shadow-2xl text-white text-xs select-none">
      <div className="flex items-center justify-between gap-3 px-1 border-b border-slate-800 pb-1.5">
        <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
          <Activity className="w-4 h-4 animate-spin text-cyan-400" />
          <span>Dev Call Switcher</span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono uppercase bg-slate-900 px-1.5 py-0.5 rounded">
          {currentState}
        </span>
      </div>

      {/* أزرار الحالات */}
      <div className="flex flex-wrap gap-1.5 max-w-[260px]">
        <button
          onClick={() => onStateChange("idle")}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium transition-all ${
            currentState === "idle"
              ? "bg-slate-700 text-white shadow-sm"
              : "bg-slate-900/80 text-slate-400 hover:text-white"
          }`}
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span>خمول</span>
        </button>

        <button
          onClick={() => onStateChange("incoming")}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium transition-all ${
            currentState === "incoming"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/50"
              : "bg-slate-900/80 text-slate-400 hover:text-emerald-300"
          }`}
        >
          <PhoneIncoming className="w-3.5 h-3.5" />
          <span>وارد</span>
        </button>

        <button
          onClick={() => onStateChange("outgoing")}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium transition-all ${
            currentState === "outgoing"
              ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/50"
              : "bg-slate-900/80 text-slate-400 hover:text-cyan-300"
          }`}
        >
          <PhoneCall className="w-3.5 h-3.5" />
          <span>صادر</span>
        </button>

        <button
          onClick={() => onStateChange("active")}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium transition-all ${
            currentState === "active"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/50"
              : "bg-slate-900/80 text-slate-400 hover:text-indigo-300"
          }`}
        >
          <Phone className="w-3.5 h-3.5" />
          <span>نشط</span>
        </button>

        <button
          onClick={() => onStateChange("minimized")}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium transition-all ${
            currentState === "minimized"
              ? "bg-amber-600 text-white shadow-md shadow-amber-900/50"
              : "bg-slate-900/80 text-slate-400 hover:text-amber-300"
          }`}
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>مصغر</span>
        </button>
      </div>

      {/* زر محاكاة التحدث/الصوت */}
      {(currentState === "active" || currentState === "minimized") && (
        <button
          onClick={onToggleSpeaking}
          className={`flex items-center justify-center gap-1.5 mt-1 py-1.5 px-3 rounded-xl font-bold transition-all ${
            isSpeaking
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : "bg-slate-900 text-slate-400 hover:text-white"
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${isSpeaking ? "animate-pulse text-emerald-400" : ""}`} />
          <span>محاكاة المتحدث: {isSpeaking ? "يتكلم 🎙️" : "صامت 🤫"}</span>
        </button>
      )}
    </div>
  );
};
export default DevCallStateSwitcher;
