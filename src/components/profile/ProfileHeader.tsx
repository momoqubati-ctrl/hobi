import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Copy, Crown, Shield, Star, Verified, X, MoreHorizontal } from "lucide-react";
import { getCountryFlagSrc, getCountryName } from "@/lib/countries";
import { cn } from "@/lib/utils";

interface ProfileHeaderProps {
  profile: any;
  user: any;
  isFollowing?: boolean;
  onFollowChange?: (following: boolean) => void;
  onClose?: () => void;
}

const getDisplayName = (user: any) => String(user?.displayName || user?.username || "عضو");
const getHandle = (user: any) => String(user?.username || user?.id || "member").replace(/\s+/g, "");
const getRankName = (evaluation: number) => {
  if (evaluation >= 500) return "ماسي";
  if (evaluation >= 200) return "برونزي";
  if (evaluation >= 75) return "فضي";
  return "عضو نشط";
};

export function ProfileHeader({ profile, user, isFollowing, onFollowChange, onClose }: ProfileHeaderProps) {
  const displayName = getDisplayName(user);
  const handle = getHandle(user);
  const isOnline = user?.presence === "online" || user?.status === "active";
  const coverUrl = profile?.bannerUrl || user?.coverUrl || "/pich.png";
  const avatarUrl = profile?.avatarUrl || user?.avatarUrl || "/pic.png";
  const nameColor = profile?.nameColor && profile.nameColor !== "#000000" ? profile.nameColor : undefined;
  const countryCode = String(user?.countryCode || "SA").toUpperCase() === "IL" ? "PS" : user?.countryCode || "SA";
  const evaluation = Number(profile?.evaluation || 0);
  const starCount = Math.max(1, Math.min(5, Math.ceil(evaluation / 100)));
  const rankName = getRankName(evaluation);

  return (
    <header className="relative">
      <div
        className="h-[178px] bg-cover bg-center"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.58)), url(${coverUrl})`,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-[14px] z-20 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition hover:translate-y-[-2px] hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="absolute right-4 bottom-3 z-20 inline-flex h-[30px] items-center gap-1.5 rounded-full border border-white/30 bg-black/45 px-3 text-xs font-black text-white/90 backdrop-blur-sm">
          <span className={cn(
            "h-[8px] w-[8px] rounded-full",
            isOnline
              ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(34,197,94,0.25)]"
              : "bg-slate-400"
          )} />
          {isOnline ? "متصل الآن" : "غير متصل"}
        </div>
        <button
          type="button"
          className="absolute left-4 bottom-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition hover:translate-y-[-2px] hover:bg-black/60"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <div className="relative -mt-[34px] rounded-t-[28px] bg-background px-6 pb-[18px] pt-3 min-h-[170px]">
        <div className="absolute -top-[70px] left-6 z-10">
          <div className="relative">
            <div
              className="rounded-full p-[5px] shadow-[0_14px_32px_rgba(124,58,237,0.36)]"
              style={{ background: "conic-gradient(#7c3aed, #ec4899, #fbbf24, #7c3aed)" }}
            >
              <Avatar className="h-[124px] w-[124px] border-[5px] border-background">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="text-3xl font-black">{displayName[0]}</AvatarFallback>
              </Avatar>
            </div>
            <span className={cn(
              "absolute bottom-[14px] right-[9px] h-[23px] w-[23px] rounded-full ring-4 ring-background",
              isOnline ? "bg-emerald-500" : "bg-slate-400"
            )} />
          </div>
        </div>

        <div className="mr-[150px] min-h-[33px] text-right">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h2 className="text-[31px] font-black leading-none text-foreground" style={{ color: nameColor }}>
              {displayName}
            </h2>
            {profile?.documents && (
              <Verified className="h-[23px] w-[23px] shrink-0 text-violet-600 fill-violet-600" />
            )}
            {(user?.role === "admin" || user?.role === "owner") && (
              <Shield className="h-5 w-5 shrink-0 text-red-500 fill-red-500" />
            )}
            <span className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-l from-purple-600 via-pink-500 to-purple-700 px-3.5 py-2 text-[15px] font-black text-white whitespace-nowrap shadow-[0_4px_12px_rgba(124,58,237,0.3)]">
              <Crown className="h-4 w-4" />
              {rankName}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mt-2">
            <div className="flex gap-0.5" style={{ direction: "ltr" }}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Star
                  key={index}
                  className={cn(
                    "h-3.5 w-3.5",
                    index < starCount
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/30"
                  )}
                />
              ))}
            </div>
            <span className="text-xs font-bold text-muted-foreground">{evaluation.toLocaleString("ar-EG")} نقطة</span>
          </div>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span dir="ltr" className="text-xs font-bold text-muted-foreground">@{handle}</span>
            <button
              type="button"
              className="grid h-6 w-6 place-items-center rounded-md border border-border bg-card text-muted-foreground transition hover:text-primary"
            >
              <Copy className="h-3 w-3" />
            </button>
            {profile?.idreg && <span className="text-xs font-bold text-muted-foreground">{profile.idreg}</span>}
            <span className="mx-1 text-muted-foreground/20">|</span>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground">
              <img src={getCountryFlagSrc(countryCode)} alt={getCountryName(countryCode)} className="h-3.5 w-4.5 rounded object-cover" />
              {getCountryName(countryCode)}
            </span>
          </div>

          {profile?.profileMsg && (
            <p className="mt-2.5 text-sm font-bold text-muted-foreground/80 leading-relaxed">
              {profile.profileMsg}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
