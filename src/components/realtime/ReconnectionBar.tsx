/**
 * ReconnectionBar
 * ───────────────
 * شريط يظهر أسفل الشاشة عند انقطاع الاتصال ويختفي فور استئنافه.
 * يستمع لحدث "reconnection:status" الذي يُطلقه reconnectionManager.
 */
import React, { useEffect, useState, useCallback } from "react";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import type { ReconnectionState, ReconnectionStatus } from "@/lib/reconnectionManager";

export const ReconnectionBar: React.FC = () => {
  const [state, setState] = useState<ReconnectionState | null>(null);
  // نُبقي الشريط مرئياً لفترة قصيرة بعد الاتصال ليرى المستخدم رسالة النجاح
  const [showSuccess, setShowSuccess] = useState(false);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStatus = useCallback((e: Event) => {
    const detail = (e as CustomEvent<ReconnectionState>).detail;
    setState(detail);

    if (detail.status === "connected") {
      setShowSuccess(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setShowSuccess(false);
        setState(null);
      }, 2500);
    } else {
      setShowSuccess(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("reconnection:status", handleStatus);
    return () => {
      window.removeEventListener("reconnection:status", handleStatus);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [handleStatus]);

  // لا شيء يُعرض إذا كان الاتصال طبيعياً
  if (!state && !showSuccess) return null;

  const status: ReconnectionStatus = state?.status ?? "connected";

  // ─── مظهر كل حالة ────────────────────────────────────────────────────────
  const config: Record<
    ReconnectionStatus,
    { bg: string; border: string; text: string; icon: React.ReactNode; label: string }
  > = {
    reconnecting: {
      bg:     "bg-amber-500/95",
      border: "border-amber-400",
      text:   "text-white",
      icon:   <Loader2 size={15} className="animate-spin shrink-0" />,
      label:  `جاري إعادة الاتصال… (${state?.attempt ?? 0}/${state?.maxAttempts ?? 10})`,
    },
    connected: {
      bg:     "bg-emerald-500/95",
      border: "border-emerald-400",
      text:   "text-white",
      icon:   <Wifi size={15} className="shrink-0" />,
      label:  "تم استئناف الاتصال ✓",
    },
    failed: {
      bg:     "bg-red-600/95",
      border: "border-red-500",
      text:   "text-white",
      icon:   <WifiOff size={15} className="shrink-0" />,
      label:  "تعذّر الاتصال. جاري تسجيل الخروج…",
    },
  };

  const c = config[status];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        fixed bottom-20 lg:bottom-4 left-1/2 -translate-x-1/2 z-[9999]
        flex items-center gap-2
        px-4 py-2 rounded-full
        shadow-lg backdrop-blur-sm
        border ${c.border} ${c.bg} ${c.text}
        text-xs font-bold
        transition-all duration-300
        animate-in fade-in slide-in-from-bottom-2
        select-none pointer-events-none
        rtl
      `}
    >
      {c.icon}
      <span>{c.label}</span>
    </div>
  );
};

export default ReconnectionBar;
