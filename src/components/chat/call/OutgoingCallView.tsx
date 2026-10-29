import React from "react";
import { PhoneOff, Sparkles, ShieldCheck, Video, Phone } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CallUser, CallMode } from "./callTypes";

interface OutgoingCallViewProps {
  user: CallUser;
  mode?: CallMode;
  isRinging?: boolean; // false = جاري الاتصال... / true = يرن...
  onCancel: () => void;
}

export const OutgoingCallView: React.FC<OutgoingCallViewProps> = ({
  user,
  mode = "voice",
  isRinging = false,
  onCancel,
}) => {
  const isVideo = mode === "video";

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-slate-950/85 backdrop-blur-2xl animate-in fade-in duration-300 p-4 select-none"
      dir="rtl"
    >
      {/* تأثير الإضاءة المحيطة المقتبسة من نوع المكالمة */}
      <div
        className={`absolute w-96 h-96 rounded-full blur-[120px] pointer-events-none animate-pulse ${
          isVideo
            ? "bg-gradient-to-tr from-cyan-500/25 via-blue-600/20 to-indigo-500/25"
            : "bg-gradient-to-tr from-emerald-500/25 via-teal-600/20 to-cyan-500/25"
        }`}
      />

      <div className="relative w-full max-w-sm rounded-3xl p-8 text-center text-slate-100 backdrop-blur-2xl bg-slate-900/70 border border-slate-700/50 shadow-2xl flex flex-col items-center">
        {/* شارة نوع المكالمة */}
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
                <Video className="w-3.5 h-3.5 text-cyan-400" />
                <span>مكالمة فيديو HD</span>
              </>
            ) : (
              <>
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                <span>مكالمة صوتية</span>
              </>
            )}
          </span>
        </div>

        {/* الصورة الشخصية مع حركة النبض الدائري الهادئ */}
        <div className="relative flex items-center justify-center my-6">
          <span
            className={`absolute w-36 h-36 rounded-full border animate-ping opacity-50 duration-1000 ${
              isVideo ? "border-cyan-400/30" : "border-emerald-400/30"
            }`}
          />
          <span
            className={`absolute w-32 h-32 rounded-full border-2 animate-pulse ${
              isVideo ? "border-cyan-400/40" : "border-emerald-400/40"
            }`}
          />

          <div
            className={`relative p-1.5 rounded-full shadow-[0_0_35px_rgba(6,182,212,0.3)] ${
              isVideo
                ? "bg-gradient-to-b from-cyan-500/40 to-blue-600/40 border border-cyan-400/50"
                : "bg-gradient-to-b from-emerald-500/40 to-teal-600/40 border border-emerald-400/50"
            }`}
          >
            <Avatar className="w-24 h-24 rounded-full border-2 border-slate-950">
              <AvatarImage
                src={user.avatar}
                alt={user.name}
                className="object-cover"
              />
              <AvatarFallback className="bg-slate-800 text-2xl font-bold text-slate-200">
                {user.name.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
          </div>

          {user.verified && (
            <div className="absolute bottom-1 right-2 p-1 bg-cyan-500 text-slate-950 rounded-full shadow-md">
              <ShieldCheck className="w-4 h-4" />
            </div>
          )}
        </div>

        {/* اسم المستخدم والشارات */}
        <div className="flex items-center gap-1.5 justify-center mb-1">
          <h2 className="text-2xl font-black text-white tracking-wide">
            {user.name}
          </h2>
          {user.rank && (
            <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              {user.rank}
            </span>
          )}
        </div>

        {/* حالة الاتصال المتغيرة */}
        <div
          className={`flex items-center gap-2 text-sm font-medium mb-10 ${
            isVideo ? "text-cyan-400" : "text-emerald-400"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full animate-ping ${
              isVideo ? "bg-cyan-400" : "bg-emerald-400"
            }`}
          />
          <span>{isRinging ? "يرن الآن..." : "جاري الاتصال..."}</span>
        </div>

        {/* زر إلغاء الاتصال */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onCancel}
            className="group w-16 h-16 rounded-full flex items-center justify-center bg-rose-600 hover:bg-rose-500 text-white shadow-[0_4px_25px_rgba(225,29,72,0.4)] hover:shadow-[0_4px_35px_rgba(225,29,72,0.6)] border border-rose-400/40 active:scale-95 transition-all duration-200"
            title="إلغاء الاتصال"
          >
            <PhoneOff className="w-7 h-7 transition-transform group-hover:rotate-12" />
          </button>
          <span className="text-xs text-slate-400 font-medium">إلغاء</span>
        </div>
      </div>
    </div>
  );
};

export default OutgoingCallView;
