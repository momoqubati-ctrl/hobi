import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  Minimize2,
  PhoneOff,
  Lock,
  Wifi,
  WifiOff,
  ShieldCheck,
  Video,
  VideoOff,
  SwitchCamera,
  Share2,
  Maximize2,
  ArrowRightLeft,
  Wand2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  CallUser,
  CallMode,
  NetworkQuality,
  StudioEffectsConfig,
} from "./callTypes";
import SoundWave from "./SoundWave";
import StudioEffectsDrawer, {
  getCssFilterString,
} from "./StudioEffectsDrawer";

interface ActiveCallViewProps {
  user: CallUser;
  mode: CallMode;
  durationSeconds: number;
  networkQuality?: NetworkQuality;
  isMuted: boolean;
  isCameraOn: boolean;
  isSpeakerOn: boolean;
  isNoiseSuppressionOn: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  isRemoteCameraOn: boolean;
  analyser?: AnalyserNode | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  effects: StudioEffectsConfig;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onFlipCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleSpeaker: () => void;
  onToggleNoiseSuppression: () => void;
  onChangeEffects: (effects: StudioEffectsConfig) => void;
  onMinimize: () => void;
  onEndCall: () => void;
}

export const ActiveCallView: React.FC<ActiveCallViewProps> = ({
  user,
  mode,
  durationSeconds,
  networkQuality = "excellent",
  isMuted,
  isCameraOn,
  isSpeakerOn,
  isNoiseSuppressionOn,
  isScreenSharing,
  isSpeaking,
  isRemoteCameraOn,
  analyser,
  localStream,
  remoteStream,
  effects,
  onToggleMute,
  onToggleCamera,
  onFlipCamera,
  onToggleScreenShare,
  onToggleSpeaker,
  onToggleNoiseSuppression,
  onChangeEffects,
  onMinimize,
  onEndCall,
}) => {
  const [isEffectsDrawerOpen, setIsEffectsDrawerOpen] = useState(false);
  const [isSwappedStreams, setIsSwappedStreams] = useState(false);
  const [showHUD, setShowHUD] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const hudTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ربط مسارات الفيديو المحلية والبعيدة بالعناصر
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isCameraOn, isSwappedStreams]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, isRemoteCameraOn, isSwappedStreams]);

  // إخفاء الـ HUD تلقائياً بعد 4 ثوانٍ من عدم النشاط في وضع الفيديو
  const resetHudTimer = () => {
    setShowHUD(true);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    if (mode === "video" && !isEffectsDrawerOpen) {
      hudTimeoutRef.current = setTimeout(() => {
        setShowHUD(false);
      }, 4000);
    }
  };

  useEffect(() => {
    resetHudTimer();
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [mode, isEffectsDrawerOpen]);

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const cssFilterStyle = getCssFilterString(
    effects.filter,
    effects.filterIntensity
  );

  const isVideoMode = mode === "video";

  return (
    <div
      onMouseMove={resetHudTimer}
      onTouchStart={resetHudTimer}
      className="fixed inset-0 z-[9990] flex flex-col justify-between items-center bg-slate-950 text-slate-100 select-none overflow-hidden animate-in fade-in duration-300"
      dir="rtl"
    >
      {/* ─────────────────────────────────────────────────────────────
          1. المسرح الرئيسي (Main Stage)
          ───────────────────────────────────────────────────────────── */}
      <div className="absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden">
        {isVideoMode && (isSwappedStreams ? isCameraOn : isRemoteCameraOn) ? (
          /* عرض الفيديو في المسرح الرئيسي */
          <div className="relative w-full h-full">
            <video
              ref={isSwappedStreams ? localVideoRef : remoteVideoRef}
              autoPlay
              playsInline
              muted={isSwappedStreams}
              style={{
                filter: isSwappedStreams ? cssFilterStyle : "none",
              }}
              className="w-full h-full object-cover transition-all duration-300"
            />
            {/* غشاء ناعم للأطراف لدمج الزجاج */}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/60 pointer-events-none" />
          </div>
        ) : (
          /* العرض الافتراضي (صوتي أو الكاميرا مغلقة): صورة المتحدث + الطيف الصوتي */
          <div className="relative flex flex-col items-center justify-center my-auto p-4 z-10">
            {/* تأثير إضاءة خلفية نيون ناعمة يتوهج مع صوت المتحدث */}
            <div
              className={`absolute w-96 h-96 rounded-full blur-[130px] pointer-events-none transition-all duration-700 ${
                isSpeaking
                  ? "bg-emerald-500/25 scale-125"
                  : isVideoMode
                  ? "bg-cyan-500/20 scale-100"
                  : "bg-cyan-500/10 scale-100"
              }`}
            />

            <div className="relative flex items-center justify-center">
              {/* حلقة التحدث المتوهجة */}
              <div
                className={`absolute w-36 h-36 rounded-full border-2 transition-all duration-300 ${
                  isSpeaking
                    ? "border-emerald-400/80 shadow-[0_0_35px_rgba(16,185,129,0.5)] scale-110"
                    : "border-cyan-500/25 scale-100"
                }`}
              />
              {isSpeaking && (
                <span className="absolute w-44 h-44 rounded-full border border-emerald-400/30 animate-ping opacity-60" />
              )}

              <div className="relative p-1.5 rounded-full bg-slate-900 border border-slate-700/60">
                <Avatar className="w-28 h-28 rounded-full border-2 border-slate-800 shadow-2xl">
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
                <div className="absolute bottom-1 right-2 p-1.5 bg-cyan-500 text-slate-950 rounded-full shadow-md">
                  <ShieldCheck className="w-4 h-4" />
                </div>
              )}
            </div>

            {/* اسم المستخدم والشارة */}
            <div className="flex items-center gap-2 mt-6">
              <h2 className="text-2xl font-black text-white">{user.name}</h2>
              {user.rank && (
                <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  {user.rank}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 mt-1 font-medium">
              {isVideoMode && !isRemoteCameraOn ? (
                <span className="text-amber-400/90 font-medium flex items-center gap-1 justify-center">
                  <VideoOff className="w-3.5 h-3.5" />
                  <span>كاميرا الطرف الآخر متوقفة مؤقتاً</span>
                </span>
              ) : isSpeaking ? (
                <span className="text-emerald-400 font-semibold animate-pulse">
                  يتحدث الآن...
                </span>
              ) : (
                "الميكروفون مفتوح"
              )}
            </p>

            {/* الطيف الصوتي التفاعلي */}
            <div className="mt-4">
              <SoundWave
                isActive={isSpeaking}
                analyser={analyser}
                color={isSpeaking ? "emerald" : "cyan"}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. نافذة العرض المحلي PiP (Local Camera Floating Preview)
          ───────────────────────────────────────────────────────────── */}
      {isVideoMode && (
        <div
          className={`absolute top-20 right-4 z-30 w-36 sm:w-48 aspect-[3/4] rounded-3xl overflow-hidden backdrop-blur-2xl bg-slate-950/80 border border-cyan-500/40 shadow-[0_15px_35px_rgba(0,0,0,0.8),0_0_20px_rgba(6,182,212,0.25)] transition-all duration-300 ${
            showHUD ? "opacity-100 scale-100" : "opacity-80 scale-95"
          }`}
        >
          {/* محاكاة الخلفية الافتراضية إذا تم اختيار صورة */}
          {effects.background === "custom" && effects.customBackgroundUrl ? (
            <img
              src={effects.customBackgroundUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-60"
            />
          ) : effects.background === "gaming-room" ? (
            <div className="absolute inset-0 bg-gradient-to-tr from-fuchsia-950 via-purple-900 to-cyan-950 opacity-70" />
          ) : effects.background === "modern-office" ? (
            <div className="absolute inset-0 bg-gradient-to-tr from-slate-900 via-stone-800 to-amber-950 opacity-70" />
          ) : effects.background === "space" ? (
            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-950 via-slate-900 to-purple-950 opacity-70" />
          ) : effects.background === "night-nature" ? (
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950 via-teal-950 to-slate-900 opacity-70" />
          ) : null}

          {/* فيديو الكاميرا المحلية مع تطبيق الفلتر */}
          {(isSwappedStreams ? isRemoteCameraOn : isCameraOn) ? (
            <video
              ref={isSwappedStreams ? remoteVideoRef : localVideoRef}
              autoPlay
              playsInline
              muted={!isSwappedStreams}
              style={{
                filter: isSwappedStreams ? "none" : cssFilterStyle,
              }}
              className="relative w-full h-full object-cover"
            />
          ) : (
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-slate-900/90 text-slate-400 p-2 text-center">
              <VideoOff className="w-6 h-6 text-slate-500 mb-1" />
              <span className="text-[10px] font-bold">الكاميرا متوقفة</span>
            </div>
          )}

          {/* أزرار التحكم السريع على نافذة الـ PiP */}
          <div className="absolute bottom-2 inset-x-2 flex items-center justify-between pointer-events-auto">
            {/* تبديل الكاميرا للأجهزة الذكية */}
            <button
              onClick={onFlipCamera}
              className="p-1.5 rounded-xl bg-slate-900/80 hover:bg-cyan-500/30 text-white backdrop-blur-md border border-white/10 transition-colors shadow-sm"
              title="تبديل الكاميرا الأمامية/الخلفية"
            >
              <SwitchCamera className="w-3.5 h-3.5" />
            </button>

            {/* تبديل نافذة العرض بين الطرفين */}
            <button
              onClick={() => setIsSwappedStreams((prev) => !prev)}
              className="p-1.5 rounded-xl bg-slate-900/80 hover:bg-cyan-500/30 text-white backdrop-blur-md border border-white/10 transition-colors shadow-sm"
              title="تبديل موقع العرض الرئيسي والمصغر"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          3. الرأس العلوي (Top HUD)
          ───────────────────────────────────────────────────────────── */}
      <div
        className={`relative z-20 w-full max-w-xl flex items-center justify-between px-4 pt-4 transition-all duration-300 ${
          showHUD
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-4 pointer-events-none"
        }`}
      >
        {/* زر التصغير */}
        <button
          onClick={onMinimize}
          className="p-2.5 rounded-2xl bg-slate-900/70 hover:bg-slate-800/90 backdrop-blur-xl border border-cyan-500/30 text-slate-300 hover:text-white transition-all active:scale-95 shadow-lg"
          title="تصغير المكالمة (PiP)"
        >
          <Minimize2 className="w-5 h-5" />
        </button>

        {/* العداد الزمني ونوع المكالمة وشارة الأمان */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-xl border border-cyan-500/35 text-xs font-mono font-bold shadow-inner">
            <span
              className={`w-2 h-2 rounded-full animate-pulse ${
                isVideoMode ? "bg-cyan-400" : "bg-emerald-400"
              }`}
            />
            <span
              className={isVideoMode ? "text-cyan-300" : "text-emerald-400"}
            >
              {formatTime(durationSeconds)}
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-[11px] font-sans font-bold text-slate-300">
              {isVideoMode ? "فيديو HD" : "صوت"}
            </span>
          </div>

          <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-400 font-medium">
            <Lock className="w-3 h-3 text-cyan-400" />
            <span>اتصال مشفر طرفاً لطرف</span>
          </div>
        </div>

        {/* مؤشر جودة الشبكة والـ Ping */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl bg-slate-900/70 backdrop-blur-xl border border-cyan-500/30 shadow-lg">
          {networkQuality === "excellent" ? (
            <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
              <Wifi className="w-4 h-4" />
              <span className="text-[10px] hidden sm:inline">ممتازة (18ms)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-amber-400 text-xs font-medium">
              <WifiOff className="w-4 h-4" />
              <span className="text-[10px] hidden sm:inline">ضعيفة</span>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          4. الشريط السفلي العائم (Enhanced Floating Glass Control Bar)
          ───────────────────────────────────────────────────────────── */}
      <div
        className={`relative z-20 w-full max-w-2xl px-3 mb-5 transition-all duration-300 ${
          showHUD
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-6 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between gap-1 sm:gap-2 px-4 py-3 rounded-3xl bg-slate-900/80 backdrop-blur-2xl border border-cyan-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.7),0_0_25px_rgba(6,182,212,0.15)]">
          {/* زر كتم الميكروفون */}
          <button
            onClick={onToggleMute}
            className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
              isMuted
                ? "text-rose-400 bg-rose-500/15 border border-rose-500/30"
                : "text-slate-300 hover:text-white hover:bg-slate-800/60"
            }`}
            title={isMuted ? "إلغاء كتم الصوت" : "كتم الميكروفون"}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center">
              {isMuted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </div>
            <span className="text-[10px] font-semibold">
              {isMuted ? "مكتوم" : "كتم"}
            </span>
          </button>

          {/* زر الكاميرا (تشغيل/إيقاف/ترقية الفيديو) */}
          <button
            onClick={onToggleCamera}
            className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
              isCameraOn
                ? "text-cyan-400 bg-cyan-500/15 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.25)]"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
            title={isCameraOn ? "إيقاف الكاميرا" : "تشغيل الكاميرا"}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center">
              {isCameraOn ? (
                <Video className="w-5 h-5" />
              ) : (
                <VideoOff className="w-5 h-5" />
              )}
            </div>
            <span className="text-[10px] font-semibold">
              {isCameraOn ? "الكاميرا" : "تشغيل"}
            </span>
          </button>

          {/* زر استوديو الفلاتر والمؤثرات ✨ */}
          <button
            onClick={() => setIsEffectsDrawerOpen(true)}
            className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
              effects.filter !== "none" || effects.background !== "none"
                ? "text-amber-300 bg-amber-500/15 border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                : "text-slate-300 hover:text-cyan-300 hover:bg-slate-800/60"
            }`}
            title="فتح استوديو الفلاتر والخلفيات"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 animate-pulse text-amber-400" />
            </div>
            <span className="text-[10px] font-semibold">فلاتر ✨</span>
          </button>

          {/* زر مشاركة الشاشة */}
          <button
            onClick={onToggleScreenShare}
            className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
              isScreenSharing
                ? "text-indigo-400 bg-indigo-500/20 border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.3)]"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
            title="مشاركة الشاشة"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center">
              <Share2 className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold">شاشة</span>
          </button>

          {/* زر عزل الضوضاء AI */}
          <button
            onClick={onToggleNoiseSuppression}
            className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
              isNoiseSuppressionOn
                ? "text-teal-300 bg-teal-500/20 border border-teal-400/40 shadow-[0_0_15px_rgba(20,184,166,0.3)]"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
            title="عزل الضوضاء الذكي"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center">
              <Wand2 className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold">عزل AI</span>
          </button>

          {/* زر مكبر الصوت */}
          <button
            onClick={onToggleSpeaker}
            className={`flex flex-col items-center gap-1 p-2 rounded-2xl transition-all active:scale-95 ${
              isSpeakerOn
                ? "text-cyan-400 bg-cyan-500/15 border border-cyan-500/30"
                : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
            title="مكبر الصوت"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center">
              {isSpeakerOn ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <VolumeX className="w-5 h-5" />
              )}
            </div>
            <span className="text-[10px] font-semibold">مكبر</span>
          </button>

          {/* زر إنهاء المكالمة الكبسولي البارز */}
          <button
            onClick={onEndCall}
            className="flex items-center justify-center w-14 h-12 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-[0_4px_25px_rgba(225,29,72,0.45)] border border-rose-400/40 active:scale-95 transition-all duration-200"
            title="إنهاء المكالمة"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          5. لوحة استوديو الفلاتر والخلفيات (Drawer Modal)
          ───────────────────────────────────────────────────────────── */}
      <StudioEffectsDrawer
        isOpen={isEffectsDrawerOpen}
        onClose={() => setIsEffectsDrawerOpen(false)}
        effects={effects}
        onChangeEffects={onChangeEffects}
      />
    </div>
  );
};

export default ActiveCallView;
