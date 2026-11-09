import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Copy, X, MoreHorizontal, Check } from "lucide-react";
import { getCountryFlagSrc, getCountryName } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { VerifiedBadge } from "./profileUtils";

interface ProfileHeaderProps {
  profile: any;
  user: any;
  isFollowing?: boolean;
  onFollowChange?: (following: boolean) => void;
  onClose?: () => void;
  moreTrigger?: React.ReactNode;
}

export function ProfileHeader({
  profile,
  user,
  onClose,
  moreTrigger,
}: ProfileHeaderProps) {
  const [copied, setCopied] = useState(false);

  const rawDisplayName = user?.displayName || user?.username || profile?.displayName;
  const displayName = rawDisplayName && String(rawDisplayName).trim() ? String(rawDisplayName).trim() : null;

  const rawHandle = user?.mentionName || profile?.mentionName;
  const handle = rawHandle && String(rawHandle).trim() ? String(rawHandle).trim().replace(/^@/, "").replace(/\s+/g, "") : null;

  const isOnline = user?.presence === "online" || user?.status === "active";
  const coverUrl = profile?.bannerUrl || user?.coverUrl || profile?.giftedBannerUrl || user?.pich;
  const avatarUrl = profile?.avatarUrl || user?.avatarUrl || "/pic.png";

  const nameColor =
    profile?.nameColor && profile.nameColor !== "#000000" && profile.nameColor !== "transparent"
      ? profile.nameColor
      : undefined;

  const statusFontColor =
    profile?.statusFontColor && profile.statusFontColor !== "#000000" && profile.statusFontColor !== "transparent"
      ? profile.statusFontColor
      : undefined;

  const rawCountryCode = user?.countryCode || profile?.countryCode;
  const countryCode = rawCountryCode ? String(rawCountryCode).toUpperCase() : null;
  const countryName = countryCode ? getCountryName(countryCode) : null;
  const flagSrc = countryCode ? getCountryFlagSrc(countryCode) : null;

  const isVerified = Boolean(
    profile?.documents || user?.documentationc || user?.role === "admin" || user?.role === "owner"
  );

  const rawBio = profile?.profileMsg || user?.msg;
  const bio = rawBio && String(rawBio).trim() ? String(rawBio).trim() : null;

  const handleCopyHandle = () => {
    if (!handle) return;
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(`@${handle}`);
      setCopied(true);
      toast.success("تم نسخ اسم المستخدم");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="relative w-full">
      {/* الغلاف العلوي مع تدرج وازرار التحكم */}
      <div
        className="relative h-[190px] w-full bg-cover bg-center overflow-hidden"
        style={{
          backgroundColor: "var(--card)",
          backgroundImage: coverUrl
            ? `linear-gradient(180deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.6) 80%, rgba(0, 0, 0, 0.85) 100%), url(${coverUrl})`
            : `radial-gradient(circle at 75% 30%, rgba(147, 51, 234, 0.35) 0%, transparent 60%), radial-gradient(circle at 25% 20%, rgba(59, 130, 246, 0.4) 0%, transparent 50%), linear-gradient(180deg, #1e293b 0%, #0f172a 100%)`,
        }}
      >
        {/* زر الإغلاق على أقصى اليسار */}
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur-md border border-border/60 transition hover:bg-background hover:scale-105 active:scale-95 shadow-md dark:bg-slate-950/70 dark:text-slate-200 dark:border-white/10 dark:hover:bg-slate-900"
          aria-label="إغلاق"
        >
          <X className="h-4 w-4" />
        </button>

        {/* زر المزيد على أقصى اليمين */}
        {moreTrigger ? (
          <div className="absolute right-4 top-4 z-20">{moreTrigger}</div>
        ) : (
          <button
            type="button"
            className="absolute right-4 top-4 z-20 grid h-8 w-8 place-items-center rounded-full bg-background/80 text-foreground backdrop-blur-md border border-border/60 transition hover:bg-background hover:scale-105 active:scale-95 shadow-md dark:bg-slate-950/70 dark:text-slate-200 dark:border-white/10 dark:hover:bg-slate-900"
            aria-label="خيارات إضافية"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* قسم هوية المستخدم - محاذاة مرئية: الأفاتار على اليسار والبيانات على اليمين */}
      <div className="relative -mt-14 px-5 pb-2 flex items-start gap-4">
        {/* الأفاتار مع حلقة النيون المشعة ومؤشر الاتصال */}
        <div className="relative group shrink-0">
          <div className="p-[3.5px] rounded-full bg-gradient-to-tr from-cyan-400 via-blue-500 to-fuchsia-500 shadow-[0_0_24px_rgba(168,85,247,0.45)] transition-transform group-hover:scale-[1.02]">
            <Avatar className="h-[96px] w-[96px] border-[3.5px] border-card bg-muted shadow-inner dark:border-[#070b18] dark:bg-slate-900">
              <AvatarImage src={avatarUrl} alt={displayName || "مستخدم"} className="object-cover" />
              <AvatarFallback className="text-2xl font-black bg-muted text-foreground dark:bg-slate-800 dark:text-slate-200">
                {displayName ? displayName[0] : "؟"}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* نقطة حالة الاتصال مدمجة بأسفل يمين الأفاتار */}
          <span
            className={cn(
              "absolute bottom-1 right-1 h-5 w-5 rounded-full border-[3px] border-card dark:border-[#070b18] shadow-sm transition-all",
              isOnline
                ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.9)]"
                : "bg-slate-400 dark:bg-slate-500"
            )}
            title={isOnline ? "متصل الآن" : "غير متصل"}
          />
        </div>

        {/* تفاصيل الهوية بجانب الأفاتار */}
        <div className="flex-1 min-w-0 pt-6">
          {/* السطر الأول: الاسم، شارة التوثيق، حالة الاتصال، الدولة */}
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="text-2xl font-black tracking-tight text-foreground dark:text-white truncate max-w-[180px]"
              style={{ color: nameColor }}
            >
              {displayName || "لا توجد بيانات حالياً"}
            </h2>

            {/* شارة التوثيق الزرقاء المرجعية */}
            {isVerified && <VerifiedBadge />}

            {/* وسام حالة الاتصال المرجعي */}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border backdrop-blur-md shrink-0",
                isOnline
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:bg-emerald-950/70 dark:border-emerald-500/40 dark:text-emerald-400"
                  : "bg-muted border-border/50 text-muted-foreground dark:bg-slate-900/70 dark:border-slate-700/50 dark:text-slate-400"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  isOnline ? "bg-emerald-500 dark:bg-emerald-400 animate-pulse" : "bg-slate-400 dark:bg-slate-500"
                )}
              />
              {isOnline ? "متصل الآن" : "غير متصل"}
            </span>

            {/* وسام الدولة وعلمها */}
            {countryName ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-card/80 border border-border/60 text-xs font-bold text-foreground backdrop-blur-md shrink-0 dark:bg-slate-900/70 dark:border-white/10 dark:text-slate-200">
                {flagSrc && (
                  <img
                    src={flagSrc}
                    alt={countryName}
                    className="h-3 w-4 rounded-xs object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = "none";
                    }}
                  />
                )}
                {countryName}
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted border border-border/40 text-[11px] text-muted-foreground shrink-0 dark:bg-slate-900/50 dark:border-white/5 dark:text-slate-400">
                لا توجد بيانات حالياً
              </span>
            )}
          </div>

          {/* السطر الثاني: المعرف @Handle */}
          {handle && (
            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyHandle}
                className="font-mono text-sm font-semibold text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-slate-200 transition flex items-center gap-1 cursor-pointer"
                title="انقر لنسخ اسم الإشارة"
              >
                <span dir="ltr">@{handle}</span>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3 opacity-50" />
                )}
              </button>
            </div>
          )}

          {/* السطر الثالث: البايو / الحالة النصية */}
          <div className="mt-1.5">
            {bio ? (
              <p
                className="text-sm font-medium text-foreground/90 dark:text-slate-200 leading-relaxed break-words"
                style={{ color: statusFontColor }}
              >
                {bio}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground dark:text-slate-500 italic">لا توجد بيانات حالياً</p>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
