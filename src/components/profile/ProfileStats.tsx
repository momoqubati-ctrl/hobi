import { Star, Users, ThumbsUp, Gift, UserCheck, Coins, Eye, Heart } from "lucide-react";
import { formatNumber } from "./profileUtils";

interface ProfileStatsProps {
  stats: {
    views?: number;
    likes?: number;
    coins?: number;
    evaluation?: number;
    giftsReceivedCount?: number;
    followersCount?: number;
    followingCount?: number;
    wallLikesCount?: number;
  } | null;
  profile?: any;
}

export function ProfileStats({ stats, profile }: ProfileStatsProps) {
  const evaluation = stats?.evaluation ?? profile?.evaluation ?? 0;
  const followersCount = stats?.followersCount ?? 0;
  const likes = stats?.likes ?? profile?.wallPostLikes ?? 0;
  const gifts = stats?.giftsReceivedCount ?? profile?.giftsReceivedCount ?? 0;

  const wallLikesCount = stats?.wallLikesCount ?? 0;
  const followingCount = stats?.followingCount ?? 0;
  const coins = stats?.coins ?? profile?.coins ?? 0;
  const views = stats?.views ?? profile?.rep ?? 0;

  return (
    <div className="mx-5 mb-3 rounded-2xl border border-border/60 bg-muted/30 text-foreground dark:border-blue-900/40 dark:bg-[#0b1226]/80 p-3.5 shadow-sm dark:shadow-inner backdrop-blur-md">
      {/* الصف الأول: الإحصائيات الأربعة الرئيسية المرجعية */}
      <div className="grid grid-cols-4 gap-2 text-center" dir="rtl">
        {/* النقاط */}
        <div className="flex flex-col items-center justify-center p-2 rounded-xl transition hover:bg-muted/50 dark:hover:bg-slate-900/50">
          <Star className="h-5 w-5 text-amber-500 dark:text-amber-400 fill-amber-400/15 mb-1 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]" />
          <span className="text-lg font-black tracking-tight text-foreground dark:text-white">
            {stats !== null ? formatNumber(evaluation) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[11px] font-semibold text-muted-foreground dark:text-slate-400 mt-0.5">النقاط</span>
        </div>

        {/* المتابعون */}
        <div className="flex flex-col items-center justify-center p-2 rounded-xl transition hover:bg-muted/50 dark:hover:bg-slate-900/50">
          <Users className="h-5 w-5 text-cyan-600 dark:text-cyan-400 mb-1 drop-shadow-[0_0_8px_rgba(34,211,238,0.3)]" />
          <span className="text-lg font-black tracking-tight text-foreground dark:text-white">
            {stats !== null ? formatNumber(followersCount) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[11px] font-semibold text-muted-foreground dark:text-slate-400 mt-0.5">المتابعون</span>
        </div>

        {/* الإعجابات (باللون الأحمر المرجعي) */}
        <div className="flex flex-col items-center justify-center p-2 rounded-xl transition hover:bg-muted/50 dark:hover:bg-slate-900/50">
          <ThumbsUp className="h-5 w-5 text-rose-500 fill-rose-500/20 mb-1 drop-shadow-[0_0_8px_rgba(244,63,94,0.3)]" />
          <span className="text-lg font-black tracking-tight text-rose-500">
            {stats !== null ? formatNumber(likes) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[11px] font-semibold text-rose-500/80 dark:text-rose-400 mt-0.5">الإعجابات</span>
        </div>

        {/* الهدايا */}
        <div className="flex flex-col items-center justify-center p-2 rounded-xl transition hover:bg-muted/50 dark:hover:bg-slate-900/50">
          <Gift className="h-5 w-5 text-purple-600 dark:text-purple-400 mb-1 drop-shadow-[0_0_8px_rgba(192,132,252,0.3)]" />
          <span className="text-lg font-black tracking-tight text-foreground dark:text-white">
            {stats !== null ? formatNumber(gifts) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[11px] font-semibold text-muted-foreground dark:text-slate-400 mt-0.5">الهدايا</span>
        </div>
      </div>

      {/* الصف الثاني: إعجابات الحائط، يتابع، العملات، المشاهدات */}
      <div className="mt-2.5 pt-2.5 border-t border-border/60 dark:border-blue-900/40 grid grid-cols-4 gap-1.5 text-center" dir="rtl">
        {/* إعجابات الحائط */}
        <div className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-card border border-border/40 transition hover:bg-muted/60 dark:bg-slate-900/40 dark:border-blue-900/20 dark:hover:bg-slate-900/70 shadow-2xs">
          <Heart className="h-4 w-4 text-pink-500 dark:text-pink-400 mb-0.5 fill-pink-400/20" />
          <span className="text-sm font-bold text-foreground dark:text-slate-100">
            {stats !== null ? formatNumber(wallLikesCount) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground dark:text-slate-400">إعجابات الحائط</span>
        </div>

        {/* يتابع */}
        <div className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-card border border-border/40 transition hover:bg-muted/60 dark:bg-slate-900/40 dark:border-blue-900/20 dark:hover:bg-slate-900/70 shadow-2xs">
          <UserCheck className="h-4 w-4 text-blue-500 dark:text-blue-400 mb-0.5" />
          <span className="text-sm font-bold text-foreground dark:text-slate-100">
            {stats !== null ? formatNumber(followingCount) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground dark:text-slate-400">يتابع</span>
        </div>

        {/* العملات */}
        <div className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-card border border-border/40 transition hover:bg-muted/60 dark:bg-slate-900/40 dark:border-blue-900/20 dark:hover:bg-slate-900/70 shadow-2xs">
          <Coins className="h-4 w-4 text-amber-500 dark:text-amber-400 mb-0.5" />
          <span className="text-sm font-bold text-amber-500 dark:text-amber-400">
            {stats !== null ? formatNumber(coins) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground dark:text-slate-400">العملات</span>
        </div>

        {/* المشاهدات */}
        <div className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-card border border-border/40 transition hover:bg-muted/60 dark:bg-slate-900/40 dark:border-blue-900/20 dark:hover:bg-slate-900/70 shadow-2xs">
          <Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-400 mb-0.5" />
          <span className="text-sm font-bold text-foreground dark:text-slate-100">
            {stats !== null ? formatNumber(views) : "لا توجد بيانات حالياً"}
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground dark:text-slate-400">المشاهدات</span>
        </div>
      </div>
    </div>
  );
}
