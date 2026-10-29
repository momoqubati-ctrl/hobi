import React, { useState } from "react";
import {
  Phone,
  PhoneOff,
  Video,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CallUser, CallMode } from "./callTypes";

interface IncomingCallModalProps {
  caller: CallUser;
  mode?: CallMode;
  onAccept: (withVideo?: boolean) => void;
  onReject: () => void;
  onQuickReply: (message: string) => void;
}

const QUICK_REPLIES = [
  "مشغول حالياً، سأعاود الاتصال لاحقاً",
  "لا أستطيع التحدث الآن، أرسل رسالة",
  "في اجتماع، سأتواصل معك قريباً",
];

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  caller,
  mode = "voice",
  onAccept,
  onReject,
  onQuickReply,
}) => {
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const isVideo = mode === "video";

  return (
    <div
      className="fixed inset-x-0 top-6 z-[9999] flex justify-center px-4 pointer-events-auto select-none"
      dir="rtl"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl p-6 text-slate-100 backdrop-blur-2xl bg-slate-950/90 border border-cyan-500/35 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.85),0_0_35px_rgba(6,182,212,0.2)] animate-in slide-in-from-top-6 duration-300">
        {/* خلفية تدرجية نيون */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div
          className={`absolute -bottom-24 -right-24 w-48 h-48 rounded-full blur-3xl pointer-events-none ${
            isVideo ? "bg-cyan-500/20" : "bg-emerald-500/15"
          }`}
        />

        <div className="flex flex-col items-center text-center">
          {/* شارة نوع المكالمة (صوتية أو فيديو) */}
          <div className="mb-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-inner ${
                isVideo
                  ? "bg-cyan-500/15 border-cyan-500/35 text-cyan-300 shadow-cyan-500/10"
                  : "bg-emerald-500/15 border-emerald-500/35 text-emerald-300 shadow-emerald-500/10"
              }`}
            >
              {isVideo ? (
                <>
                  <Video className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  <span>مكالمة فيديو HD واردة</span>
                </>
              ) : (
                <>
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>مكالمة صوتية واردة</span>
                </>
              )}
            </span>
          </div>

          {/* الصورة الرمزية مع حلقات النبض المشعة (Pulsing Ripple Rings) */}
          <div className="relative flex items-center justify-center mb-3 mt-1">
            <span
              className={`absolute w-28 h-28 rounded-full border animate-ping opacity-75 duration-1000 ${
                isVideo ? "border-cyan-400/40" : "border-emerald-400/40"
              }`}
            />
            <span
              className={`absolute w-24 h-24 rounded-full border-2 animate-pulse ${
                isVideo ? "border-cyan-400/50" : "border-emerald-400/50"
              }`}
            />
            <div
              className={`relative p-1 rounded-full shadow-[0_0_25px_rgba(6,182,212,0.35)] ${
                isVideo
                  ? "bg-gradient-to-tr from-cyan-500/60 via-blue-500/60 to-indigo-500/60"
                  : "bg-gradient-to-tr from-cyan-500/50 via-emerald-500/50 to-teal-500/50"
              }`}
            >
              <Avatar className="w-20 h-20 rounded-full border-2 border-slate-900 shadow-inner">
                <AvatarImage
                  src={caller.avatar}
                  alt={caller.name}
                  className="object-cover"
                />
                <AvatarFallback className="bg-slate-800 text-lg font-bold text-slate-200">
                  {caller.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
            </div>
            {caller.verified && (
              <div className="absolute bottom-0 right-1 p-1 bg-cyan-500 text-slate-950 rounded-full shadow-md">
                <ShieldCheck className="w-4 h-4" />
              </div>
            )}
          </div>

          {/* معلومات المتصل */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-xl font-black text-white tracking-wide">
              {caller.name}
            </h3>
            {caller.rank && (
              <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                {caller.rank}
              </span>
            )}
          </div>

          <div
            className={`flex items-center gap-2 text-xs font-semibold mb-5 animate-pulse ${
              isVideo ? "text-cyan-400" : "text-emerald-400"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isVideo ? "bg-cyan-400" : "bg-emerald-400"
              }`}
            />
            <span>
              {isVideo ? "يتصل بك فيديو..." : "يتصل بك صوتياً..."}
            </span>
          </div>

          {/* أزرار الإجراءات الرئيسية */}
          {isVideo ? (
            /* في حالة مكالمة الفيديو: خيار الرد بالفيديو، أو بالصوت فقط، والرفض */
            <div className="flex flex-col gap-2.5 w-full mb-3">
              <div className="grid grid-cols-2 gap-3 w-full">
                {/* زر الرد بالفيديو */}
                <button
                  onClick={() => onAccept(true)}
                  className="group flex items-center justify-center gap-2 py-3.5 px-3 rounded-2xl font-bold text-xs bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 shadow-[0_4px_25px_rgba(6,182,212,0.4)] hover:shadow-[0_4px_30px_rgba(6,182,212,0.6)] active:scale-95 transition-all duration-200 border border-cyan-300/40"
                >
                  <Video className="w-4 h-4 text-slate-950 animate-bounce" />
                  <span>الرد بالفيديو</span>
                </button>

                {/* زر الرد بالصوت فقط */}
                <button
                  onClick={() => onAccept(false)}
                  className="group flex items-center justify-center gap-2 py-3.5 px-3 rounded-2xl font-bold text-xs bg-slate-900/90 hover:bg-slate-800 text-emerald-400 border border-emerald-500/40 shadow-sm active:scale-95 transition-all duration-200"
                >
                  <Phone className="w-4 h-4 text-emerald-400" />
                  <span>صوت فقط</span>
                </button>
              </div>

              {/* زر الرفض الكامل للمكالمة */}
              <button
                onClick={onReject}
                className="group flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 hover:border-rose-500/50 active:scale-95 transition-all duration-200"
              >
                <PhoneOff className="w-4 h-4 text-rose-400 transition-transform group-hover:rotate-12" />
                <span>رفض المكالمة</span>
              </button>
            </div>
          ) : (
            /* في حالة المكالمة الصوتية */
            <div className="grid grid-cols-2 gap-4 w-full mb-3">
              {/* زر الرفض */}
              <button
                onClick={onReject}
                className="group flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm bg-gradient-to-r from-rose-600/90 to-red-600/90 hover:from-rose-500 hover:to-red-500 text-white shadow-[0_4px_20px_rgba(225,29,72,0.3)] hover:shadow-[0_4px_25px_rgba(225,29,72,0.45)] active:scale-95 transition-all duration-200 border border-rose-400/30"
              >
                <PhoneOff className="w-5 h-5 transition-transform group-hover:rotate-12" />
                <span>رفض</span>
              </button>

              {/* زر القبول */}
              <button
                onClick={() => onAccept(false)}
                className="group flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-[0_4px_25px_rgba(16,185,129,0.4)] hover:shadow-[0_4px_30px_rgba(16,185,129,0.6)] active:scale-95 transition-all duration-200 border border-emerald-300/40"
              >
                <Phone className="w-5 h-5 animate-[bounce_1.5s_infinite] text-slate-950" />
                <span>قبول</span>
              </button>
            </div>
          )}

          {/* خيار الرد السريع */}
          <div className="w-full mt-2">
            <button
              type="button"
              onClick={() => setShowQuickReplies(!showQuickReplies)}
              className="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs font-medium text-slate-400 hover:text-cyan-300 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>رد برسالة سريعة</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  showQuickReplies ? "rotate-180 text-cyan-400" : ""
                }`}
              />
            </button>

            {showQuickReplies && (
              <div className="flex flex-col gap-1.5 mt-2.5 w-full animate-in fade-in slide-in-from-top-2 duration-200">
                {QUICK_REPLIES.map((reply, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      onQuickReply(reply);
                      setShowQuickReplies(false);
                    }}
                    className="w-full text-right py-2 px-3 text-xs rounded-xl bg-slate-900/60 hover:bg-cyan-950/40 border border-slate-800 hover:border-cyan-500/30 text-slate-300 hover:text-cyan-200 transition-all active:scale-[0.98]"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;
