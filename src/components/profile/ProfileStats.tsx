import { Users, Star, Heart, Gift, ThumbsUp, UserPlus, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileStatsProps {
  stats: {
    views: number;
    likes: number;
    coins: number;
    evaluation: number;
    giftsReceivedCount?: number;
    followersCount?: number;
    followingCount?: number;
    wallLikesCount?: number;
  };
}

const formatNumber = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toLocaleString("ar-EG", { maximumFractionDigits: 1 })}M`;
  if (value >= 1000) return `${(value / 1000).toLocaleString("ar-EG", { maximumFractionDigits: 1 })}K`;
  return value.toLocaleString("ar-EG");
};

export function ProfileStats({ stats }: ProfileStatsProps) {
  if (!stats) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-3 px-[22px] pb-3">
        <div className="min-h-[92px] rounded-[18px] border border-border bg-card shadow-sm flex items-center justify-center gap-[10px] transition hover:translate-y-[-2px] hover:shadow-md">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <div className="text-right">
            <strong className="block text-[25px] font-black leading-none text-foreground">{formatNumber(Number(stats.followersCount || 0))}</strong>
            <span className="text-xs font-black text-muted-foreground">متابعون</span>
          </div>
        </div>
        <div className="min-h-[92px] rounded-[18px] bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-[0_16px_30px_rgba(37,99,235,0.34)] flex items-center justify-center gap-[10px] transition hover:translate-y-[-2px] hover:shadow-[0_16px_28px_rgba(20,28,45,0.09)]">
          <div className="h-12 w-12 rounded-full bg-white/15 text-amber-300 border border-white/25 flex items-center justify-center shrink-0">
            <Star className="h-6 w-6 fill-amber-300" />
          </div>
          <div className="text-right">
            <strong className="block text-[25px] font-black leading-none text-primary-foreground">{formatNumber(Number(stats.evaluation || 0))}</strong>
            <span className="text-xs font-black text-primary-foreground/80">نقاط</span>
          </div>
        </div>
        <div className="min-h-[92px] rounded-[18px] border border-border bg-card shadow-sm flex items-center justify-center gap-[10px] transition hover:translate-y-[-2px] hover:shadow-md">
          <div className="h-12 w-12 rounded-full bg-rose-50 dark:bg-rose-500/20 flex items-center justify-center shrink-0 text-rose-500">
            <Heart className="h-6 w-6 fill-rose-500" />
          </div>
          <div className="text-right">
            <strong className="block text-[25px] font-black leading-none text-foreground">{formatNumber(Number(stats.likes || 0))}</strong>
            <span className="text-xs font-black text-muted-foreground">إعجابات</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 px-[22px] pb-[14px]">
        <div className="h-[62px] rounded-xl border border-border bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-black text-center transition hover:translate-y-[-2px] hover:shadow-md">
          <Gift className="h-3.5 w-3.5 text-primary" />
          {formatNumber(Number(stats.giftsReceivedCount || 0))}
          <span className="text-[9px] font-black text-muted-foreground">الهدايا</span>
        </div>
        <div className="h-[62px] rounded-xl border border-border bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-black text-center transition hover:translate-y-[-2px] hover:shadow-md">
          <ThumbsUp className="h-3.5 w-3.5 text-rose-500" />
          {formatNumber(Number(stats.wallLikesCount || 0))}
          <span className="text-[9px] font-black text-muted-foreground">إعجابات الحائط</span>
        </div>
        <div className="h-[62px] rounded-xl border border-border bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-black text-center transition hover:translate-y-[-2px] hover:shadow-md">
          <UserPlus className="h-3.5 w-3.5 text-primary" />
          {formatNumber(Number(stats.followingCount || 0))}
          <span className="text-[9px] font-black text-muted-foreground">يتابع</span>
        </div>
        <div className="h-[62px] rounded-xl border border-border bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-[11px] font-black text-center transition hover:translate-y-[-2px] hover:shadow-md">
          <Coins className="h-3.5 w-3.5 text-amber-500" />
          {formatNumber(Number(stats.coins || 0))}
          <span className="text-[9px] font-black text-muted-foreground">العملات</span>
        </div>
      </div>
    </>
  );
}
