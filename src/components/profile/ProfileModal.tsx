import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { getSocket } from "@/lib/socket";
import { ProfileHeader } from "./ProfileHeader";
import { ProfileStats } from "./ProfileStats";
import { ProfileActions } from "./ProfileActions";
import { ProfileAdminPanel } from "./ProfileAdminPanel";
import { IconPickerPopover } from "./IconPickerPopover";
import { Trophy, Eye, Medal, MessageCircle, ThumbsUp, Flame, Award, Plus, Crown, Star, EyeIcon, Image, Gift, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProfileModalProps {
  profileId: string | null;
  onClose: () => void;
  isAdmin: boolean;
  onMessage?: (profileId: string) => void;
}

const getRankName = (evaluation: number) => {
  if (evaluation >= 500) return "ماسي";
  if (evaluation >= 200) return "برونزي";
  if (evaluation >= 75) return "فضي";
  return "عضو نشط";
};

const getNextRankAt = (evaluation: number) => {
  if (evaluation >= 500) return 500;
  if (evaluation >= 200) return 500;
  if (evaluation >= 75) return 200;
  return 75;
};

export function ProfileModal({ profileId, onClose, isAdmin, onMessage }: ProfileModalProps) {
  const socket = getSocket();
  const [profileData, setProfileData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [relationship, setRelationship] = useState({ isSelf: false, isFollowing: false });
  const [visitors, setVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profileId) return;

    let active = true;
    setProfileData(null);
    setStats(null);
    setRelationship({ isSelf: false, isFollowing: false });
    setVisitors([]);
    setLoading(true);

    const timeoutId = window.setTimeout(() => {
      if (!active) return;
      setLoading(false);
      toast.error("تعذر تحميل بيانات الملف الشخصي؛ يرجى المحاولة مرة أخرى.");
      onClose();
    }, 10000);

    socket.emit("profile:view", { profileId, hidden: isAdmin }, (response: any) => {
      if (!active) return;
      clearTimeout(timeoutId);

      if (response && response.success && response.profile) {
        setProfileData(response.profile);
        setStats(response.stats);
        setRelationship(response.relationship || { isSelf: false, isFollowing: false });
        setVisitors(response.visitors || []);
      } else {
        toast.error(response?.error || "تعذر تحميل بيانات الملف الشخصي");
        onClose();
      }

      setLoading(false);
    });

    const onProfileUpdated = (updates: any) => {
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile ? { ...prev.profile, ...updates } : updates,
        };
      });
    };

    const onUserProfileUpdated = (data: any) => {
      if (data && String(data.userId) === String(profileId)) {
        setProfileData((prev: any) => {
          if (!prev) return null;
          return {
            ...prev,
            username: data.username || prev.username,
            displayName: data.username || prev.displayName,
            avatarUrl: data.avatar || data.avatarUrl || prev.avatarUrl,
            coverUrl: data.profileCover || data.cover || prev.coverUrl,
            profile: prev.profile ? {
              ...prev.profile,
              profileMsg: data.profileMsg !== undefined ? data.profileMsg : prev.profile.profileMsg,
              avatarUrl: data.avatar || data.avatarUrl || prev.profile.avatarUrl,
              bannerUrl: data.profileCover || data.cover || prev.profile.bannerUrl,
              giftedBannerUrl: data.giftedBannerUrl !== undefined ? data.giftedBannerUrl : prev.profile.giftedBannerUrl,
              giftedGiftIconUrl: data.giftedGiftIconUrl !== undefined ? data.giftedGiftIconUrl : prev.profile.giftedGiftIconUrl,
              giftedPromotionIconUrl: data.giftedPromotionIconUrl !== undefined ? data.giftedPromotionIconUrl : prev.profile.giftedPromotionIconUrl,
            } : null,
          };
        });
      }
    };

    socket.on("profile:updated", onProfileUpdated);
    socket.on("user_profile_updated", onUserProfileUpdated);

    const onGiftBannerReceived = (data: any) => {
      if (data && String(data.fromUserId) !== String(profileId) && String(data.userId) !== String(profileId) && String(data.toUserId) !== String(profileId)) return;
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile ? { ...prev.profile, giftedBannerUrl: data.iconUrl || "" } : { giftedBannerUrl: data.iconUrl || "" },
        };
      });
    };

    const onGiftIconReceived = (data: any) => {
      if (data && String(data.fromUserId) !== String(profileId) && String(data.userId) !== String(profileId) && String(data.toUserId) !== String(profileId)) return;
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile ? { ...prev.profile, giftedGiftIconUrl: data.iconUrl || "" } : { giftedGiftIconUrl: data.iconUrl || "" },
        };
      });
    };

    const onGiftPromotionIconReceived = (data: any) => {
      if (data && String(data.fromUserId) !== String(profileId) && String(data.userId) !== String(profileId) && String(data.toUserId) !== String(profileId)) return;
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile ? { ...prev.profile, giftedPromotionIconUrl: data.iconUrl || "" } : { giftedPromotionIconUrl: data.iconUrl || "" },
        };
      });
    };

    socket.on("gift_banner_received", onGiftBannerReceived);
    socket.on("gift_icon_received", onGiftIconReceived);
    socket.on("gift_promotion_icon_received", onGiftPromotionIconReceived);

    return () => {
      active = false;
      clearTimeout(timeoutId);
      socket.off("profile:updated", onProfileUpdated);
      socket.off("user_profile_updated", onUserProfileUpdated);
      socket.off("gift_banner_received", onGiftBannerReceived);
      socket.off("gift_icon_received", onGiftIconReceived);
      socket.off("gift_promotion_icon_received", onGiftPromotionIconReceived);
    };
  }, [profileId, isAdmin, onClose, socket]);

  if (!profileId) return null;

  const profile = profileData?.profile || {};
  const evaluation = Number(stats?.evaluation || profile.evaluation || 0);
  const rankName = getRankName(evaluation);
  const nextRankAt = getNextRankAt(evaluation);
  const progress = Math.min(100, Math.round((evaluation / Math.max(nextRankAt, 1)) * 100));
  const remainingPoints = Math.max(0, nextRankAt - evaluation);

  return (
    <>
    <Dialog open={!!profileId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex flex-col w-full max-w-[430px] h-[96dvh] max-h-[96dvh] p-0 gap-0 overflow-y-auto rounded-3xl border-border bg-background text-foreground shadow-[0_34px_90px_rgba(0,0,0,0.48)] [&>button]:hidden"
        dir="rtl"
      >
        <DialogTitle className="sr-only">عرض الملف الشخصي</DialogTitle>
        <DialogDescription className="sr-only">تحميل وعرض بيانات الملف الشخصي للمستخدم.</DialogDescription>

        {loading || !profileData ? (
          <div className="flex flex-col bg-background rounded-3xl animate-pulse">
            <div className="h-[178px] bg-muted rounded-t-3xl" />
            <div className="relative px-6 pb-[18px] pt-3">
              <div className="absolute -top-[70px] right-6 z-10">
                <div className="h-[124px] w-[124px] rounded-full bg-muted-foreground/20" />
              </div>
              <div className="mr-[150px] space-y-3 min-h-[150px] pt-2">
                <div className="h-8 w-1/2 bg-muted-foreground/20 rounded-lg" />
                <div className="h-4 w-1/3 bg-muted-foreground/15 rounded-md" />
                <div className="h-4 w-2/3 bg-muted-foreground/15 rounded-md" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 px-[22px] pb-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-[92px] rounded-[18px] bg-muted" />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2 px-[22px] pb-[14px]">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[58px] rounded-xl bg-muted" />
              ))}
            </div>
            <div className="mx-[22px] mb-3 h-[42px] rounded-xl bg-muted" />
            <div className="mx-[22px] mb-3 h-[42px] rounded-xl bg-muted" />
            <div className="mx-[22px] mb-3 h-[150px] rounded-2xl bg-muted" />
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-30 h-12 flex items-center justify-center bg-background/95 backdrop-blur-md border-b border-border shrink-0">
              <h1 className="text-sm font-black text-foreground">ملف المستخدم</h1>
            </div>

            <ProfileHeader
              profile={profile}
              user={profileData}
              isFollowing={relationship.isFollowing}
              onFollowChange={(following) => setRelationship((current) => ({ ...current, isFollowing: following }))}
              onClose={onClose}
            />

            {/* أزرار الإهداء للأدمن */}
            {isAdmin && !relationship.isSelf && (
              <div className="mx-[22px] mt-2 mb-1 rounded-2xl border border-border bg-card shadow-sm p-3">
                <p className="text-[10px] font-black text-muted-foreground mb-2">أدوات الإهداء</p>
                <div className="flex gap-2">
                  <IconPickerPopover
                    type="banner"
                    profileId={profileData.id || profileId}
                    currentIconUrl={profile?.giftedBannerUrl || ""}
                    onSelect={(url) => {
                      setProfileData((prev: any) => ({
                        ...prev,
                        profile: { ...prev?.profile, giftedBannerUrl: url },
                      }));
                    }}
                    onRemove={() => {
                      setProfileData((prev: any) => ({
                        ...prev,
                        profile: { ...prev?.profile, giftedBannerUrl: "" },
                      }));
                    }}
                    trigger={
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-l from-pink-500 to-rose-500 text-white text-[10px] font-black shadow-sm hover:shadow-md transition">
                        <Image className="h-3.5 w-3.5" />
                        البنر
                      </button>
                    }
                  />
                  <IconPickerPopover
                    type="gift_icon"
                    profileId={profileData.id || profileId}
                    currentIconUrl={profile?.giftedGiftIconUrl || ""}
                    onSelect={(url) => {
                      setProfileData((prev: any) => ({
                        ...prev,
                        profile: { ...prev?.profile, giftedGiftIconUrl: url },
                      }));
                    }}
                    onRemove={() => {
                      setProfileData((prev: any) => ({
                        ...prev,
                        profile: { ...prev?.profile, giftedGiftIconUrl: "" },
                      }));
                    }}
                    trigger={
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-l from-blue-500 to-indigo-500 text-white text-[10px] font-black shadow-sm hover:shadow-md transition">
                        <Gift className="h-3.5 w-3.5" />
                        ايقونة
                      </button>
                    }
                  />
                  <IconPickerPopover
                    type="promotion_icon"
                    profileId={profileData.id || profileId}
                    currentIconUrl={profile?.giftedPromotionIconUrl || ""}
                    onSelect={(url) => {
                      setProfileData((prev: any) => ({
                        ...prev,
                        profile: { ...prev?.profile, giftedPromotionIconUrl: url },
                      }));
                    }}
                    onRemove={() => {
                      setProfileData((prev: any) => ({
                        ...prev,
                        profile: { ...prev?.profile, giftedPromotionIconUrl: "" },
                      }));
                    }}
                    trigger={
                      <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-l from-amber-500 to-orange-500 text-white text-[10px] font-black shadow-sm hover:shadow-md transition">
                        <TrendingUp className="h-3.5 w-3.5" />
                        الترقية
                      </button>
                    }
                  />
                </div>
              </div>
            )}

            <ProfileStats stats={stats} />

            <div className="mx-[22px] mb-3 h-[42px] rounded-xl bg-gradient-to-l from-primary/5 to-card dark:from-primary/10 dark:to-card border border-border/80 text-xs font-black flex items-center justify-between px-4 transition hover:bg-muted/30">
              <div className="flex items-center gap-2 text-muted-foreground">
                <EyeIcon className="h-4 w-4" />
                مشاهدات البروفايل
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary rounded-full w-5 h-5 grid place-items-center text-[10px]">{visitors.length || 0}</span>
                {visitors.length > 0 && (
                  <div className="flex -space-x-1.5 rtl:space-x-reverse">
                    {visitors.slice(0, 3).map((v: any) => (
                      <img key={v.id} src={v.avatarUrl || "/pic.png"} alt="" className="h-6 w-6 rounded-full border-2 border-background object-cover" />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <section className={cn(
              "mx-[22px] mb-3 rounded-2xl border border-border bg-card shadow-sm",
              "dark:border-border dark:bg-card"
            )}>
              <div className="grid grid-cols-[120px_1fr] gap-4 p-4">
                <div className="rounded-2xl bg-gradient-to-b from-primary/5 to-card dark:from-primary/10 dark:to-card flex flex-col items-center justify-center min-h-[100px]">
                  <Trophy className="h-[48px] w-[48px] text-amber-500 drop-shadow-[0_8px_10px_rgba(124,58,237,0.25)]" />
                  <span className="mt-2 bg-gradient-to-l from-purple-600 via-pink-500 to-purple-700 text-white px-3.5 py-[4px] rounded-full text-[11px] font-black shadow-[0_4px_10px_rgba(124,58,237,0.25)]">{rankName}</span>
                </div>
                <div className="flex flex-col justify-center">
                  <h3 className="text-[17px] font-black mb-2.5">الترقية التالية</h3>
                  <div className="flex justify-between items-center text-xs font-black text-muted-foreground mb-2 gap-2">
                    <span className="truncate">{progress >= 100 ? "وصلت إلى متطلبات هذه الرتبة" : `نحو ترقية رتبة ${rankName}`}</span>
                    <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-full shrink-0">{progress}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden mb-2.5">
                    <span className="block h-full rounded-full bg-gradient-to-l from-primary via-fuchsia-500 to-amber-400" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs font-black text-muted-foreground leading-relaxed flex justify-between gap-2">
                    <span>الحالي: {rankName} / {evaluation.toLocaleString("ar-EG")} نقطة</span>
                    <b className="text-primary">المتبقي: {remainingPoints.toLocaleString("ar-EG")} نقطة</b>
                  </p>
                </div>
              </div>
            </section>

            <div className="flex items-center justify-between px-[26px] mt-4 mb-3">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="text-base font-black">الإنجازات</span>
              </div>
              <button className="text-xs font-black text-primary no-underline transition hover:opacity-80">عرض كل الإنجازات</button>
            </div>

            <div className="grid grid-cols-3 gap-3 px-[22px] pb-3">
              <div className="min-h-[92px] rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center justify-center text-center gap-2 relative transition-all hover:translate-y-[-3px] hover:shadow-lg">
                <span className="absolute top-2 left-2 bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300 px-[6px] py-[2px] rounded-full text-[10px] font-black">{stats?.totalMessages || 100}</span>
                <div className="h-[46px] w-[46px] rounded-full bg-gradient-to-br from-violet-600 to-[#5b21b6] text-white flex items-center justify-center shadow-[0_8px_18px_rgba(124,58,237,0.22)]">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <h4 className="text-xs font-black">محادث نشط</h4>
                <p className="text-[10px] font-black text-muted-foreground">أرسلت {stats?.totalMessages?.toLocaleString("ar-EG") || 100} رسالة</p>
              </div>
              <div className="min-h-[92px] rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center justify-center text-center gap-2 relative transition-all hover:translate-y-[-3px] hover:shadow-lg">
                <span className="absolute top-2 left-2 bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 px-[6px] py-[2px] rounded-full text-[10px] font-black">{stats?.likes || 500}</span>
                <div className="h-[46px] w-[46px] rounded-full bg-gradient-to-br from-blue-600 to-sky-400 text-white flex items-center justify-center shadow-[0_8px_18px_rgba(37,99,235,0.22)]">
                  <ThumbsUp className="h-5 w-5" />
                </div>
                <h4 className="text-xs font-black">مثير للإعجاب</h4>
                <p className="text-[10px] font-black text-muted-foreground">حصلت على {stats?.likes?.toLocaleString("ar-EG") || 500} إعجاب</p>
              </div>
              <div className="min-h-[92px] rounded-2xl border border-border bg-card shadow-sm flex flex-col items-center justify-center text-center gap-2 relative transition-all hover:translate-y-[-3px] hover:shadow-lg">
                <span className="absolute top-2 left-2 bg-emerald-50 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 px-[6px] py-[2px] rounded-full text-[10px] font-black">{stats?.activeDays || 7}</span>
                <div className="h-[46px] w-[46px] rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-[0_8px_18px_rgba(16,185,129,0.22)]">
                  <Flame className="h-5 w-5" />
                </div>
                <h4 className="text-xs font-black">أسبوع نشط</h4>
                <p className="text-[10px] font-black text-muted-foreground">نشط لمدة {stats?.activeDays || 7} أيام</p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-[26px] mt-2 mb-3">
              <Medal className="h-4 w-4 text-primary" />
              <span className="text-base font-black">الشارات</span>
            </div>

            <div className="mx-[22px] mb-[14px] h-[58px] rounded-[14px] border border-border bg-muted/30 flex items-center justify-end gap-3 px-[14px] py-2 overflow-hidden">
              {profile?.siteBadge ? (
                <>
                  <div className="h-[38px] shrink-0 rounded-lg bg-gradient-to-br from-purple-600 to-pink-500 text-white flex items-center gap-1.5 px-3 text-xs font-black shadow-[0_4px_10px_rgba(124,58,237,0.2)]">
                    <Medal className="h-3.5 w-3.5" />
                    {profile.siteBadge}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-[38px] h-[38px] shrink-0 grid place-items-center text-white bg-gradient-to-br from-violet-600 to-[#5b21b6] shadow-[0_6px_14px_rgba(124,58,237,0.22)] transition hover:translate-y-[-2px] hover:shadow-lg" style={{ clipPath: "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%)" }}>
                    <Award className="h-[17px] w-[17px]" />
                  </div>
                  <div className="w-[38px] h-[38px] shrink-0 grid place-items-center text-white bg-gradient-to-br from-blue-600 to-blue-700 shadow-[0_6px_14px_rgba(37,99,235,0.22)] transition hover:translate-y-[-2px] hover:shadow-lg" style={{ clipPath: "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%)" }}>
                    <Star className="h-[17px] w-[17px]" />
                  </div>
                  <div className="w-[38px] h-[38px] shrink-0 grid place-items-center text-white bg-gradient-to-br from-amber-700 to-amber-600 shadow-[0_6px_14px_rgba(180,83,9,0.22)] transition hover:translate-y-[-2px] hover:shadow-lg" style={{ clipPath: "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%)" }}>
                    <Crown className="h-[17px] w-[17px]" />
                  </div>
                </>
              )}
              <div className="w-[38px] h-[38px] shrink-0 grid place-items-center border-2 border-dashed border-muted-foreground/30 text-muted-foreground/50 rounded-xl transition hover:bg-muted/50">
                <Plus className="h-[17px] w-[17px]" />
              </div>
            </div>

            <div className="mx-[22px] mb-[14px] rounded-2xl border border-border bg-card shadow-sm p-3 flex items-center justify-between gap-3 transition hover:translate-y-[-2px] hover:shadow-md">
              <div className="flex items-center gap-3">
                <div className="w-[54px] h-[54px] rounded-2xl flex items-center justify-center bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-800/20 shadow-[inset_0_0_0_1px_rgba(254,215,170,0.5)]">
                  <Crown className="h-7 w-7 text-amber-500" />
                </div>
                <div>
                  <h4 className="text-base font-black">{rankName}</h4>
                  <p className="text-[11px] font-black text-muted-foreground">تم الوصول إليها في {new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })}</p>
                </div>
              </div>
              <div className="text-xs font-black text-muted-foreground flex items-center gap-1.5 text-left shrink-0">
                <Trophy className="h-4 w-4 text-amber-500" />
                أعلى رتبة تم الوصول إليها
              </div>
            </div>

            {visitors.length > 0 && (
              <div className="px-[22px] mb-3">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="h-4 w-4 text-primary" />
                  <h3 className="text-xs font-black">من زار ملفي الشخصي</h3>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {visitors.slice(0, 6).map((visitor: any) => (
                    <div key={`${visitor.id}-${visitor.visitedAt}`} className="flex items-center gap-2 shrink-0 rounded-xl bg-muted/50 p-2 border border-border">
                      <img src={visitor.avatarUrl || "/pic.png"} alt="" className="h-8 w-8 rounded-full object-cover" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-foreground">{visitor.displayName || visitor.username}</p>
                        <p className="truncate text-[10px] font-black text-muted-foreground">
                          {new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(visitor.visitedAt))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="px-[22px] mb-3">
                <ProfileAdminPanel
                  profileId={profileData.id || profileId}
                  currentRole={profileData.role}
                  isMuted={profileData.profile?.muted || profileData.muted || false}
                  onProfilePatch={(patch) => {
                    setProfileData((current: any) => {
                      if (!current) return null;
                      return {
                        ...current,
                        displayName: patch.displayName ?? current.displayName,
                        profile: current.profile ? { ...current.profile, ...patch.profile } : patch.profile,
                      };
                    });
                    if (patch.stats) {
                      setStats((current: any) => current ? { ...current, ...patch.stats } : null);
                    }
                  }}
                />
              </div>
            )}

            <ProfileActions
              profileId={profileData.id || profileId}
              profileName={profileData.displayName || profileData.username || "عضو"}
              profileAvatar={profile?.avatarUrl || profileData.avatarUrl || "/pic.png"}
              isSelf={relationship.isSelf}
              initialFollowing={relationship.isFollowing}
              initialCooldownRemaining={relationship.cooldownRemaining || 0}
              onFollowChange={(following) => setRelationship((current) => ({ ...current, isFollowing: following }))}
              onFollowerCountChange={(followerCount) => {
                setStats((current: any) => ({ ...current, followersCount: followerCount }));
              }}
              onLikeChange={(likesCount) => {
                setStats((current: any) => ({ ...current, likes: likesCount }));
              }}
              onMessage={onMessage}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  </>
  );
}
