import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { getSocket } from "@/lib/socket";
import { ProfileHeader } from "./ProfileHeader";
import { ProfileStats } from "./ProfileStats";
import { ProfileActions } from "./ProfileActions";
import { IconPickerPopover } from "./IconPickerPopover";
import {
  calculateUserLevel,
  getRankName,
  getNextRankAt,
  LevelShieldBadge,
} from "./profileUtils";
import {
  ShieldCheck,
  Star,
  Trophy,
  Flame,
  ChevronLeft,
  Eye,
  Image,
  Gift,
  TrendingUp,
  MessageCircle,
  ThumbsUp,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProfileModalProps {
  profileId: string | null;
  onClose: () => void;
  isAdmin: boolean;
  onMessage?: (profileId: string) => void;
}

export function ProfileModal({ profileId, onClose, isAdmin, onMessage }: ProfileModalProps) {
  const socket = getSocket();
  const [profileData, setProfileData] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [relationship, setRelationship] = useState({ isSelf: false, isFollowing: false, cooldownRemaining: 0 });
  const [visitors, setVisitors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // حوارات وتفاصيل إضافية
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);
  const [showRankDetailsModal, setShowRankDetailsModal] = useState(false);
  const [showVisitorsModal, setShowVisitorsModal] = useState(false);

  // فحص صلاحية الأدمن الشاملة (من الـ prop ومخزن المتصفح)
  const currentUser = (() => {
    try {
      const raw = localStorage.getItem("user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const userRole = String(currentUser?.role || "").toLowerCase().trim();
  const userPower = String(currentUser?.power || "").toLowerCase().trim();

  const effectiveIsAdmin = Boolean(
    isAdmin ||
    ["admin", "owner", "ispower", "مالك", "ادمن", "أدمن", "سوبر", "moderator"].includes(userRole) ||
    ["admin", "owner", "ispower", "مالك", "ادمن", "أدمن", "سوبر", "moderator"].includes(userPower) ||
    (Array.isArray(currentUser?.permissions) &&
      currentUser.permissions.some((p: string) =>
        typeof p === "string" && ["admin", "cpanel", "control_panel", "cp.all"].includes(p.toLowerCase())
      ))
  );

  const canManageRoles = Boolean(
    ["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"].includes(userRole) ||
    ["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"].includes(userPower) ||
    (Array.isArray(currentUser?.permissions) &&
      currentUser.permissions.some((p: string) =>
        typeof p === "string" && (
          p.startsWith("setpower") ||
          p.startsWith("admin_roles") ||
          p.startsWith("roles")
        )
      ))
  );

  useEffect(() => {
    if (!profileId) return;

    let active = true;
    setProfileData(null);
    setStats(null);
    setRelationship({ isSelf: false, isFollowing: false, cooldownRemaining: 0 });
    setVisitors([]);
    setLoading(true);

    const timeoutId = window.setTimeout(() => {
      if (!active) return;
      setLoading(false);
      toast.error("تعذر تحميل بيانات الملف الشخصي؛ يرجى المحاولة مرة أخرى.");
      onClose();
    }, 10000);

    socket.emit("profile:view", { profileId, hidden: effectiveIsAdmin }, (response: any) => {
      if (!active) return;
      clearTimeout(timeoutId);

      if (response && response.success && response.profile) {
        setProfileData(response.profile);
        setStats(response.stats);
        setRelationship(response.relationship || { isSelf: false, isFollowing: false, cooldownRemaining: 0 });
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
            displayName: data.displayName || data.username || prev.displayName,
            mentionName: data.mentionName !== undefined ? data.mentionName : prev.mentionName,
            publicUserId: data.publicUserId || prev.publicUserId,
            avatarUrl: data.avatar || data.avatarUrl || prev.avatarUrl,
            coverUrl: data.profileCover || data.cover || prev.coverUrl,
            profile: prev.profile
              ? {
                  ...prev.profile,
                  profileMsg: data.profileMsg !== undefined ? data.profileMsg : prev.profile.profileMsg,
                  avatarUrl: data.avatar || data.avatarUrl || prev.profile.avatarUrl,
                  bannerUrl: data.profileCover || data.cover || prev.profile.bannerUrl,
                  giftedBannerUrl: data.giftedBannerUrl !== undefined ? data.giftedBannerUrl : prev.profile.giftedBannerUrl,
                  giftedGiftIconUrl: data.giftedGiftIconUrl !== undefined ? data.giftedGiftIconUrl : prev.profile.giftedGiftIconUrl,
                  giftedPromotionIconUrl: data.giftedPromotionIconUrl !== undefined ? data.giftedPromotionIconUrl : prev.profile.giftedPromotionIconUrl,
                }
              : null,
          };
        });
      }
    };

    socket.on("profile:updated", onProfileUpdated);
    socket.on("user_profile_updated", onUserProfileUpdated);

    const onGiftBannerReceived = (data: any) => {
      if (
        data &&
        String(data.fromUserId) !== String(profileId) &&
        String(data.userId) !== String(profileId) &&
        String(data.toUserId) !== String(profileId)
      )
        return;
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile
            ? { ...prev.profile, giftedBannerUrl: data.iconUrl || "" }
            : { giftedBannerUrl: data.iconUrl || "" },
        };
      });
    };

    const onGiftIconReceived = (data: any) => {
      if (
        data &&
        String(data.fromUserId) !== String(profileId) &&
        String(data.userId) !== String(profileId) &&
        String(data.toUserId) !== String(profileId)
      )
        return;
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile
            ? { ...prev.profile, giftedGiftIconUrl: data.iconUrl || "" }
            : { giftedGiftIconUrl: data.iconUrl || "" },
        };
      });
    };

    const onGiftPromotionIconReceived = (data: any) => {
      if (
        data &&
        String(data.fromUserId) !== String(profileId) &&
        String(data.userId) !== String(profileId) &&
        String(data.toUserId) !== String(profileId)
      )
        return;
      setProfileData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          profile: prev.profile
            ? { ...prev.profile, giftedPromotionIconUrl: data.iconUrl || "" }
            : { giftedPromotionIconUrl: data.iconUrl || "" },
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
  }, [profileId, effectiveIsAdmin, onClose, socket]);

  if (!profileId) return null;

  const profile = profileData?.profile || {};
  const evaluation = Number(stats?.evaluation ?? profile?.evaluation ?? 0);
  const explicitLevel = Number(profileData?.level || profile?.level || 0);
  const levelInfo = calculateUserLevel(evaluation, explicitLevel > 0 ? explicitLevel : undefined);
  const rankName = getRankName(evaluation);
  const nextRankAt = getNextRankAt(evaluation);
  const isOnline = profileData?.presence === "online" || profileData?.status === "active";
  const isVerified = Boolean(
    profile?.documents || profileData?.documentationc || profileData?.role === "admin" || profileData?.role === "owner"
  );

  return (
    <>
      <Dialog open={!!profileId} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="flex flex-col w-full max-w-[460px] max-h-[92dvh] p-0 gap-0 overflow-y-auto rounded-[28px] border border-border/80 bg-card text-card-foreground shadow-2xl backdrop-blur-2xl dark:border-blue-500/30 dark:bg-[#070b18]/95 dark:text-white dark:shadow-[0_0_50px_rgba(30,58,138,0.35)] [&>button]:hidden scrollbar-thin"
          dir="rtl"
        >
          <DialogTitle className="sr-only">الملف الشخصي</DialogTitle>
          <DialogDescription className="sr-only">عرض وإدارة بيانات الملف الشخصي للمستخدم.</DialogDescription>

          {loading || !profileData ? (
            /* هيكل التحميل الشبح المتطابق مع التصميم */
            <div className="flex flex-col bg-card dark:bg-[#070b18] rounded-[28px] animate-pulse">
              <div className="h-[180px] bg-muted dark:bg-slate-900/80 rounded-t-[28px]" />
              <div className="relative px-5 pb-4 -mt-12 flex items-center gap-4">
                <div className="h-[96px] w-[96px] rounded-full bg-muted-foreground/20 dark:bg-slate-800 border-[3.5px] border-card dark:border-[#070b18] shrink-0" />
                <div className="flex-1 space-y-2 pt-6">
                  <div className="h-6 w-1/2 bg-muted dark:bg-slate-800 rounded-lg" />
                  <div className="h-4 w-1/3 bg-muted/70 dark:bg-slate-850 rounded-md" />
                  <div className="h-4 w-3/4 bg-muted/70 dark:bg-slate-850 rounded-md" />
                </div>
              </div>
              <div className="mx-5 mb-3 h-[44px] rounded-2xl bg-muted/60 dark:bg-slate-900/60" />
              <div className="mx-5 mb-3 h-[96px] rounded-2xl bg-muted/60 dark:bg-slate-900/60" />
              <div className="mx-5 mb-3 h-[68px] rounded-2xl bg-muted/60 dark:bg-slate-900/60" />
              <div className="mx-5 mb-4 h-[120px] rounded-2xl bg-muted/60 dark:bg-slate-900/60" />
            </div>
          ) : (
            <div className="flex flex-col pb-5">
              {/* 1. ترويسة البروفايل: الغلاف، الأفاتار، الهوية والبايو */}
              <ProfileHeader
                profile={profile}
                user={profileData}
                isFollowing={relationship.isFollowing}
                onFollowChange={(following) =>
                  setRelationship((current) => ({ ...current, isFollowing: following }))
                }
                onClose={onClose}
              />

              {/* 2. صف الأزرار الثلاثي المرجعي: إرسال رسالة، متابعة، والمزيد */}
              <ProfileActions
                profileId={profileData.id || profileId}
                profileName={profileData.displayName || profileData.username || "عضو"}
                profileAvatar={profile?.avatarUrl || profileData.avatarUrl || "/pic.png"}
                handle={profileData.mentionName || ""}
                isSelf={relationship.isSelf}
                isAdmin={effectiveIsAdmin}
                canManageRoles={canManageRoles}
                targetRole={profileData.role}
                isMuted={profileData.profile?.muted || profileData.muted || false}
                currentDisplayName={profileData.displayName || profileData.username}
                currentProfileMsg={profileData.profile?.profileMsg || ""}
                currentLikes={stats?.likes}
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
                    setStats((current: any) => (current ? { ...current, ...patch.stats } : null));
                  }
                }}
                initialFollowing={relationship.isFollowing}
                initialCooldownRemaining={relationship.cooldownRemaining || 0}
                onFollowChange={(following) =>
                  setRelationship((current) => ({ ...current, isFollowing: following }))
                }
                onFollowerCountChange={(followerCount) => {
                  setStats((current: any) => ({ ...current, followersCount: followerCount }));
                }}
                onLikeChange={(likesCount) => {
                  setStats((current: any) => ({ ...current, likes: likesCount }));
                }}
                onMessage={onMessage}
                onOpenVisitors={() => setShowVisitorsModal(true)}
              />

              {/* 3. أدوات الإهداء للأدمن (منح بنر، منح أيقونة، منح ترقية) في مكان مخصص وبارز */}
              {effectiveIsAdmin && !relationship.isSelf && (
                <div className="mx-5 mb-3 rounded-2xl border border-pink-500/30 bg-[#0b1226]/90 p-3 shadow-inner backdrop-blur-md">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-xs font-black text-pink-400 flex items-center gap-1.5">
                      <Gift className="h-4 w-4" />
                      أدوات الإهداء والتخصيص
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium bg-slate-900/60 px-2 py-0.5 rounded-full border border-white/5">
                      صلاحيات المشرف
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
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
                        <button
                          type="button"
                          className="w-full flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-xs font-black shadow-md transition active:scale-95 cursor-pointer"
                        >
                          <Image className="h-3.5 w-3.5" />
                          <span>منح بنر</span>
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
                        <button
                          type="button"
                          className="w-full flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black shadow-md transition active:scale-95 cursor-pointer"
                        >
                          <Gift className="h-3.5 w-3.5" />
                          <span>منح أيقونة</span>
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
                        <button
                          type="button"
                          className="w-full flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-black shadow-md transition active:scale-95 cursor-pointer"
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                          <span>منح ترقية</span>
                        </button>
                      }
                    />
                  </div>
                </div>
              )}

              {/* 4. بطاقة الإحصائيات الكاملة (النقاط، المتابعون، الإعجابات، الهدايا، إعجابات الحائط، يتابع، العملات، المشاهدات) */}
              <ProfileStats stats={stats} profile={profile} />

              {/* 5. بطاقة المستوى والتقدم المرجعية مع درع المستوى ثلاثي الأبعاد وشريط النيون */}
              <div className="mx-5 mb-3 rounded-2xl border border-border/60 bg-muted/30 text-foreground dark:border-blue-900/40 dark:bg-[#0b1226]/80 p-3.5 flex items-center justify-between gap-3.5 shadow-sm dark:shadow-inner backdrop-blur-md">
                {/* درع المستوى على اليمين */}
                <LevelShieldBadge level={levelInfo.level} />

                {/* تفاصيل المستوى وشريط التقدم في المنتصف */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5 text-xs font-bold">
                    <span className="text-primary dark:text-cyan-400 text-sm font-black">المستوى {levelInfo.level}</span>
                    <span className="text-muted-foreground dark:text-slate-400 font-mono">{levelInfo.percentage}%</span>
                  </div>
                  <div className="h-2 w-full bg-muted dark:bg-slate-900/90 rounded-full overflow-hidden border border-border/40 dark:border-white/5 p-0.5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-400 shadow-[0_0_12px_rgba(6,182,212,0.6)] transition-all duration-700"
                      style={{ width: `${levelInfo.percentage}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] font-medium text-muted-foreground dark:text-slate-400">
                    {levelInfo.percentage}% نحو المستوى التالي
                  </p>
                </div>

                {/* زر السهم على اليسار لعرض تفاصيل الترقية */}
                <button
                  type="button"
                  onClick={() => setShowRankDetailsModal(true)}
                  className="h-8 w-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/60 transition shrink-0 cursor-pointer"
                  title="عرض متطلبات الرتبة والمستوى"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              </div>

              {/* 6. قسم الشارات والإنجازات المرجعي مع البطاقات الـ 4 */}
              <div className="mx-5 mb-3 rounded-2xl border border-border/60 bg-muted/30 text-foreground dark:border-blue-900/40 dark:bg-[#0b1226]/80 p-4 shadow-sm dark:shadow-inner backdrop-blur-md">
                {/* شريط عنوان القسم وزر عرض الكل */}
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2 text-foreground dark:text-white font-black text-sm">
                    <ShieldCheck className="h-4 w-4 text-primary dark:text-blue-400" />
                    <span>الشارات والإنجازات</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAchievementsModal(true)}
                    className="text-xs font-bold text-primary dark:text-blue-400 hover:opacity-80 transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>عرض الكل</span>
                    <span dir="ltr">←</span>
                  </button>
                </div>

                {/* شبكة الشارات الأربعة من اليمين إلى اليسار */}
                <div className="grid grid-cols-4 gap-2.5" dir="rtl">
                  {/* الشارة 1: إنجازات */}
                  <div className="bg-card dark:bg-slate-900/60 border border-border/60 dark:border-blue-900/30 rounded-xl p-3 flex flex-col items-center justify-center text-center gap-2 transition hover:border-amber-500/40 hover:bg-muted/60 dark:hover:bg-slate-900/90 shadow-xs">
                    <div className="h-10 w-10 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
                      <Star className="h-5 w-5 fill-amber-400" />
                    </div>
                    <span className="text-xs font-bold text-foreground dark:text-slate-200">إنجازات</span>
                  </div>

                  {/* الشارة 2: مشارك مميز */}
                  <div className="bg-card dark:bg-slate-900/60 border border-border/60 dark:border-blue-900/30 rounded-xl p-3 flex flex-col items-center justify-center text-center gap-2 transition hover:border-cyan-500/40 hover:bg-muted/60 dark:hover:bg-slate-900/90 shadow-xs">
                    <div className="h-10 w-10 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-500 dark:text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                      <Trophy className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-bold text-foreground dark:text-slate-200 truncate max-w-full">
                      {profile?.siteBadge ||
                        (profileData?.role && profileData.role !== "member" ? "مشارك مميز" : "مشارك مميز")}
                    </span>
                  </div>

                  {/* الشارة 3: نشط */}
                  <div className="bg-card dark:bg-slate-900/60 border border-border/60 dark:border-blue-900/30 rounded-xl p-3 flex flex-col items-center justify-center text-center gap-2 transition hover:border-orange-500/40 hover:bg-muted/60 dark:hover:bg-slate-900/90 shadow-xs">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center shadow-xs",
                        isOnline || (stats?.activeDays && stats.activeDays > 0)
                          ? "bg-orange-500/20 border border-orange-500/40 text-orange-500 dark:text-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.3)]"
                          : "bg-muted border border-border/40 text-muted-foreground dark:bg-slate-800/40 dark:border-white/5 dark:text-slate-500"
                      )}
                    >
                      <Flame className={cn("h-5 w-5", isOnline ? "fill-orange-500/30" : "")} />
                    </div>
                    <span className="text-xs font-bold text-foreground dark:text-slate-200">
                      {isOnline || (stats?.activeDays && stats.activeDays > 0) ? "نشط" : "غير نشط"}
                    </span>
                  </div>

                  {/* الشارة 4: موثق */}
                  <div className="bg-card dark:bg-slate-900/60 border border-border/60 dark:border-blue-900/30 rounded-xl p-3 flex flex-col items-center justify-center text-center gap-2 transition hover:border-purple-500/40 hover:bg-muted/60 dark:hover:bg-slate-900/90 shadow-xs">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center shadow-xs",
                        isVerified
                          ? "bg-purple-500/20 border border-purple-500/40 text-purple-600 dark:text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.3)]"
                          : "bg-muted border border-border/40 text-muted-foreground dark:bg-slate-800/40 dark:border-white/5 dark:text-slate-500"
                      )}
                    >
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-bold text-foreground dark:text-slate-200">
                      {isVerified ? "موثق" : "غير موثق"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 7. زوار الملف الشخصي (إذا وجد زوار) */}
              {visitors.length > 0 && (
                <div className="mx-5 mb-3 flex items-center justify-between px-3.5 py-2.5 rounded-2xl border border-border/60 bg-muted/30 dark:border-blue-900/30 dark:bg-[#0b1226]/80 text-xs shadow-sm dark:shadow-inner text-foreground dark:text-slate-300">
                  <div className="flex items-center gap-2 font-semibold">
                    <Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                    <span>من زار ملفي الشخصي</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-400 border border-cyan-300 dark:border-cyan-500/30 font-bold rounded-full px-2 py-0.5 text-[11px]">
                      {visitors.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowVisitorsModal(true)}
                      className="text-xs text-primary dark:text-blue-400 hover:underline cursor-pointer font-bold"
                    >
                      عرض
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* حوار تفاصيل الرتبة والتقدم */}
      <Dialog open={showRankDetailsModal} onOpenChange={setShowRankDetailsModal}>
        <DialogContent className="max-w-[420px] bg-card text-card-foreground border-border dark:bg-[#0b1226] dark:border-blue-900/50 dark:text-white rounded-3xl p-5 shadow-2xl" dir="rtl">
          <DialogTitle className="text-base font-black flex items-center gap-2 text-foreground dark:text-white">
            <Trophy className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            تفاصيل الرتبة والمستوى
          </DialogTitle>
          <DialogDescription className="sr-only">معلومات تفصيلية حول مستوى المستخدم ورتبته</DialogDescription>

          <div className="mt-3 space-y-4">
            <div className="p-4 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5 flex items-center gap-4">
              <LevelShieldBadge level={levelInfo.level} />
              <div>
                <h4 className="text-sm font-black text-foreground dark:text-white">الرتبة الحالية: {rankName}</h4>
                <p className="text-xs text-muted-foreground dark:text-slate-400 mt-1">إجمالي النقاط: {evaluation} نقطة</p>
                <p className="text-xs text-primary dark:text-cyan-400 font-bold mt-0.5">المستوى: {levelInfo.level}</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5">
              <div className="flex justify-between items-center text-xs font-bold text-foreground dark:text-slate-300 mb-2">
                <span>التقدم نحو الترقية التالية:</span>
                <span className="text-primary dark:text-cyan-400">{levelInfo.percentage}%</span>
              </div>
              <div className="h-2 bg-muted dark:bg-slate-800 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                  style={{ width: `${levelInfo.percentage}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground dark:text-slate-400">
                <span>المتبقي: {levelInfo.remainingPoints} نقطة</span>
                <span>الهدف: {levelInfo.nextLevelPoints} نقطة</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowRankDetailsModal(false)}
              className="w-full py-2.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white text-xs font-bold transition cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* حوار كل الإنجازات */}
      <Dialog open={showAchievementsModal} onOpenChange={setShowAchievementsModal}>
        <DialogContent className="max-w-[420px] bg-card text-card-foreground border-border dark:bg-[#0b1226] dark:border-blue-900/50 dark:text-white rounded-3xl p-5 shadow-2xl" dir="rtl">
          <DialogTitle className="text-base font-black flex items-center gap-2 text-foreground dark:text-white">
            <Star className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            سجل الإنجازات الكامل
          </DialogTitle>
          <DialogDescription className="sr-only">قائمة الإنجازات والشارات التي حصل عليها المستخدم</DialogDescription>

          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-violet-600/15 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground dark:text-slate-400">الرسائل</span>
                  <p className="text-sm font-black text-foreground dark:text-white">{stats?.totalMessages ?? "لا توجد بيانات حالياً"}</p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-rose-600/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <ThumbsUp className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground dark:text-slate-400">الإعجابات</span>
                  <p className="text-sm font-black text-foreground dark:text-white">{stats?.likes ?? "لا توجد بيانات حالياً"}</p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Flame className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground dark:text-slate-400">الأيام النشطة</span>
                  <p className="text-sm font-black text-foreground dark:text-white">{stats?.activeDays ?? "لا توجد بيانات حالياً"}</p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-600/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Coins className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground dark:text-slate-400">العملات</span>
                  <p className="text-sm font-black text-foreground dark:text-white">{stats?.coins ?? "لا توجد بيانات حالياً"}</p>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Eye className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                <span className="text-xs text-foreground dark:text-slate-300">مشاهدات الملف الشخصي</span>
              </div>
              <span className="text-xs font-black text-cyan-600 dark:text-cyan-400">{stats?.views ?? "لا توجد بيانات حالياً"}</span>
            </div>

            {profile?.siteBadge && (
              <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Trophy className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span className="text-xs text-purple-700 dark:text-purple-200">وسام الموقع التكريمي</span>
                </div>
                <span className="text-xs font-black text-white bg-purple-600 px-2.5 py-0.5 rounded-full">
                  {profile.siteBadge}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowAchievementsModal(false)}
              className="w-full py-2.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white text-xs font-bold transition cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* حوار زوار الملف الشخصي */}
      <Dialog open={showVisitorsModal} onOpenChange={setShowVisitorsModal}>
        <DialogContent className="max-w-[400px] bg-card text-card-foreground border-border dark:bg-[#0b1226] dark:border-blue-900/50 dark:text-white rounded-3xl p-5 shadow-2xl" dir="rtl">
          <DialogTitle className="text-base font-black flex items-center gap-2 text-foreground dark:text-white">
            <Eye className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            زوار الملف الشخصي ({visitors.length})
          </DialogTitle>
          <DialogDescription className="sr-only">قائمة المستخدمين الذين زاروا هذا الملف الشخصي مؤخراً</DialogDescription>

          <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto">
            {visitors.length > 0 ? (
              visitors.map((visitor: any) => (
                <div
                  key={`${visitor.id}-${visitor.visitedAt}`}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-muted/50 border border-border/50 dark:bg-slate-900/70 dark:border-white/5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={visitor.avatarUrl || "/pic.png"}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover border border-border dark:border-white/10"
                    />
                    <span className="text-xs font-black text-foreground dark:text-white truncate max-w-[140px]">
                      {visitor.displayName || visitor.username}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground dark:text-slate-400 font-mono">
                    {new Intl.DateTimeFormat("ar", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    }).format(new Date(visitor.visitedAt))}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground dark:text-slate-400 text-center py-6">لا يوجد زوار مسجلون حالياً</p>
            )}

            <button
              type="button"
              onClick={() => setShowVisitorsModal(false)}
              className="w-full mt-3 py-2.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white text-xs font-bold transition cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
