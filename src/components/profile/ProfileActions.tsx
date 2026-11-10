import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import {
  MessageCircle,
  UserPlus,
  UserCheck,
  ThumbsUp,
  Bell,
  Loader2,
  MoreHorizontal,
  Share2,
  Shield,
  Gift,
  Eye,
  Flag,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertSenderPopup } from "./AlertSenderPopup";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import {
  useProfileAdmin,
  ProfileAdminMenuItems,
  ProfileAdminDialogs,
} from "./ProfileAdminPanel";
import GiftSendAction from "@/components/chat/GiftSendAction";
import { useRealtimeStore } from "@/lib/realtime-store";
import { canRunProfileAdminAction } from "@/lib/profileAdminPermissions";

interface ProfileActionsProps {
  profileId: string;
  profileName?: string;
  profileAvatar?: string;
  handle?: string;
  isSelf?: boolean;
  isAdmin?: boolean;
  canManageRoles?: boolean;
  targetRole?: string;
  isMuted?: boolean;
  currentDisplayName?: string;
  currentProfileMsg?: string;
  currentLikes?: number;
  initialFollowing?: boolean;
  initialCooldownRemaining?: number;
  onFollowChange?: (following: boolean) => void;
  onFollowerCountChange?: (followerCount: number) => void;
  onLikeChange?: (likesCount: number) => void;
  onProfilePatch?: (patch: any) => void;
  onMessage?: (profileId: string) => void;
  onOpenAdminPanel?: () => void;
  onOpenVisitors?: () => void;
  onOpenGifting?: () => void;
}

export function ProfileActions({
  profileId,
  profileName = "عضو",
  profileAvatar = "/pic.png",
  handle,
  isSelf = false,
  isAdmin = false,
  canManageRoles = false,
  targetRole,
  isMuted = false,
  currentDisplayName,
  currentProfileMsg,
  currentLikes,
  initialFollowing = false,
  initialCooldownRemaining = 0,
  onFollowChange,
  onFollowerCountChange,
  onLikeChange,
  onProfilePatch,
  onMessage,
  onOpenAdminPanel,
  onOpenVisitors,
  onOpenGifting,
}: ProfileActionsProps) {
  const socket = getSocket();
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(initialCooldownRemaining);
  const [likeLoading, setLikeLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const admin = useProfileAdmin({
    profileId,
    isMuted,
    onProfilePatch,
  });

  const userPermissions = useRealtimeStore((state) => state.userPermissions);
  const canSendAlert = Boolean(isAdmin) && canRunProfileAdminAction(userPermissions, "alert");

  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing, profileId]);

  useEffect(() => {
    setCooldownRemaining(initialCooldownRemaining);
  }, [initialCooldownRemaining, profileId]);

  useEffect(() => {
    if (cooldownRemaining > 0) {
      intervalRef.current = setInterval(() => {
        setCooldownRemaining((prev) => {
          if (prev <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cooldownRemaining]);

  const handleFollow = useCallback(() => {
    if (isSelf || !socket || loading) return;
    setLoading(true);
    socket.emit("profile:follow", { profileId }, (res: any) => {
      setLoading(false);
      if (res.success) {
        setFollowing(Boolean(res.following));
        onFollowChange?.(Boolean(res.following));
        if (res.followerCount !== undefined) {
          onFollowerCountChange?.(Number(res.followerCount) || 0);
        }
        toast.success(res.following ? "تمت المتابعة بنجاح" : "تم إلغاء المتابعة");
      } else {
        toast.error(res.error || "حدث خطأ أثناء المتابعة");
      }
    });
  }, [isSelf, socket, loading, profileId, onFollowChange, onFollowerCountChange]);

  const handleLike = useCallback(() => {
    if (!socket || likeLoading || cooldownRemaining > 0) return;
    setLikeLoading(true);
    socket.emit("profile:like", { profileId }, (res: any) => {
      setLikeLoading(false);
      if (res.success) {
        setCooldownRemaining(60);
        onLikeChange?.(Number(res.likesCount) || 0);
        toast.success("تم تسجيل الإعجاب بنجاح ❤️");
      } else {
        toast.error(res.error || "حدث خطأ أثناء الإعجاب");
      }
    });
  }, [socket, likeLoading, cooldownRemaining, profileId, onLikeChange]);

  const handleCopyProfileLink = () => {
    if (navigator?.clipboard) {
      const url = `${window.location.origin}/profile/${profileId}`;
      navigator.clipboard.writeText(url);
      toast.success("تم نسخ رابط الملف الشخصي بنجاح");
    }
  };

  const handleCopyHandle = () => {
    if (handle && navigator?.clipboard) {
      navigator.clipboard.writeText(`@${handle}`);
      toast.success("تم نسخ المعرف بنجاح");
    }
  };

  const isCoolingDown = cooldownRemaining > 0;

  return (
    <>
      {/* صف الأزرار التفاعلية المرجعي الثلاثي */}
      <div className="mx-5 mb-3 flex items-center gap-2.5">
        {/* زر إرسال رسالة: بنفس التدرج البنفسجي/الأزرق المشع من الصورة المرجعية */}
        <button
          type="button"
          onClick={() => onMessage?.(profileId)}
          className="flex-1 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white font-black text-sm shadow-[0_4px_16px_rgba(99,102,241,0.35)] flex items-center justify-center gap-2 transition active:scale-[0.98]"
        >
          <MessageCircle className="h-4 w-4" />
          <span>إرسال رسالة</span>
        </button>

        {/* زر المتابعة: تصميم متجاوب مع الثيم الفاتح والداكن */}
        {!isSelf ? (
          <button
            type="button"
            disabled={loading}
            onClick={handleFollow}
            className={cn(
              "flex-1 py-2.5 px-4 rounded-2xl border font-black text-sm flex items-center justify-center gap-2 transition active:scale-[0.98]",
              following
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/20 dark:bg-emerald-950/40 dark:border-emerald-500/40 dark:text-emerald-300"
                : "bg-card hover:bg-muted border-border text-foreground shadow-xs dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:border-blue-500/30 dark:text-white"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary dark:text-cyan-400" />
            ) : following ? (
              <>
                <UserCheck className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                <span>متابع</span>
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4 text-primary dark:text-blue-400" />
                <span>متابعة</span>
              </>
            )}
          </button>
        ) : (
          <div className="flex-1 py-2.5 px-4 rounded-2xl border border-border/60 bg-muted/40 text-muted-foreground font-bold text-xs flex items-center justify-center text-center dark:border-blue-500/20 dark:bg-slate-900/40 dark:text-slate-400">
            ملفك الشخصي
          </div>
        )}

        {!isSelf && (
          <GiftSendAction
            recipient={{ id: profileId, name: profileName, role: targetRole }}
            iconOnly
            className="h-11 w-11 rounded-2xl"
          />
        )}

        {/* زر القائمة والمزيد (...) متجاوب مع الثيم الفاتح والداكن */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="w-12 py-2.5 rounded-2xl bg-card hover:bg-muted border border-border text-foreground flex items-center justify-center transition active:scale-[0.98] shadow-xs dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:border-white/10 dark:text-white"
              aria-label="خيارات إضافية"
            >
              <MoreHorizontal className="h-5 w-5 text-muted-foreground dark:text-slate-300" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            collisionPadding={12}
            avoidCollisions={true}
            className="w-64 overflow-y-auto overscroll-contain bg-card/98 border border-border text-card-foreground shadow-lg rounded-2xl p-1.5 focus:outline-none dark:bg-[#0b1226]/98 dark:border-blue-900/50 dark:text-slate-200 scrollbar-thin"
            style={{
              maxHeight: "min(360px, calc(var(--radix-dropdown-menu-content-available-height, 400px) - 20px))",
            }}
            dir="rtl"
          >
            <DropdownMenuItem
              onClick={handleLike}
              disabled={isCoolingDown || likeLoading}
              className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-rose-500 hover:text-rose-600 focus:text-rose-600 hover:bg-rose-50 focus:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:focus:text-rose-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold transition-colors"
            >
              <ThumbsUp className="h-4 w-4 text-rose-500" />
              <span>
                {likeLoading
                  ? "جاري التسجيل..."
                  : isCoolingDown
                  ? `إعجاب (${cooldownRemaining}ث)`
                  : "إعجاب بالملف الشخصي"}
              </span>
            </DropdownMenuItem>

            {handle && (
              <DropdownMenuItem
                onClick={handleCopyHandle}
                className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-foreground hover:text-foreground focus:text-foreground hover:bg-muted focus:bg-muted dark:text-slate-200 dark:hover:text-white dark:focus:text-white dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 transition-colors"
              >
                <Copy className="h-4 w-4 text-muted-foreground dark:text-slate-400" />
                <span>نسخ المعرف</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={handleCopyProfileLink}
              className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-foreground hover:text-blue-600 focus:text-blue-600 hover:bg-muted focus:bg-muted dark:text-slate-200 dark:hover:text-blue-400 dark:focus:text-blue-400 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 transition-colors"
            >
              <Share2 className="h-4 w-4 text-blue-500" />
              <span>نسخ رابط الملف الشخصي</span>
            </DropdownMenuItem>

            {canSendAlert && !isSelf && (
              <DropdownMenuItem
                onClick={() => setAlertOpen(true)}
                className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-foreground hover:text-amber-600 focus:text-amber-600 hover:bg-muted focus:bg-muted dark:text-slate-200 dark:hover:text-amber-400 dark:focus:text-amber-400 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 transition-colors"
              >
                <Bell className="h-4 w-4 text-amber-500" />
                <span>إرسال تنبيه</span>
              </DropdownMenuItem>
            )}

            {onOpenVisitors && (
              <DropdownMenuItem
                onClick={onOpenVisitors}
                className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-foreground hover:text-cyan-600 focus:text-cyan-600 hover:bg-muted focus:bg-muted dark:text-slate-200 dark:hover:text-cyan-400 dark:focus:text-cyan-400 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 transition-colors"
              >
                <Eye className="h-4 w-4 text-cyan-500" />
                <span>زوار الملف الشخصي</span>
              </DropdownMenuItem>
            )}

            {/* أدوات الإدارة والتحكم تظهر في القائمة بدلاً من أسفل البروفايل */}
            {isAdmin && (
              <ProfileAdminMenuItems
                currentRole={targetRole}
                isMuted={admin.isMuted}
                isSelf={isSelf}
                canManageRoles={canManageRoles}
                onOpenEdit={() => setTimeout(() => admin.setEditDialogOpen(true), 50)}
                onOpenPower={() => setTimeout(() => admin.setPowerDialogOpen(true), 50)}
                onOpenRoom={() => setTimeout(() => admin.setRoomDialogOpen(true), 50)}
                runAction={admin.runAction}
                askText={admin.askText}
              />
            )}

            {onOpenGifting && !isSelf && (
              <DropdownMenuItem
                onClick={onOpenGifting}
                className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-pink-600 hover:text-pink-700 focus:text-pink-700 hover:bg-pink-50 focus:bg-pink-50 dark:text-pink-400 dark:hover:text-pink-300 dark:focus:text-pink-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold transition-colors"
              >
                <Gift className="h-4 w-4 text-pink-500 dark:text-pink-400" />
                <span>أدوات الإهداء</span>
              </DropdownMenuItem>
            )}

            {!isSelf && (
              <>
                <DropdownMenuSeparator className="bg-border/60 dark:bg-white/10 my-1" />
                <DropdownMenuItem
                  onClick={() => toast.success("تم إرسال البلاغ للإدارة للمراجعة")}
                  className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-rose-600 hover:text-rose-700 focus:text-rose-700 hover:bg-rose-50 focus:bg-rose-50 dark:text-red-400 dark:hover:text-red-300 dark:focus:text-red-300 dark:hover:bg-rose-950/40 dark:focus:bg-rose-950/40 transition-colors"
                >
                  <Flag className="h-4 w-4 text-rose-500 dark:text-red-400" />
                  <span>إبلاغ عن المستخدم</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* نوافذ حوار أدوات الإدارة الثلاثة (تعديل البيانات، الصلاحيات، سحب إلى غرفة) */}
      {isAdmin && (
        <ProfileAdminDialogs
          profileId={profileId}
          currentRole={targetRole || "member"}
          currentDisplayName={currentDisplayName}
          currentProfileMsg={currentProfileMsg}
          currentLikes={currentLikes}
          editDialogOpen={admin.editDialogOpen}
          setEditDialogOpen={admin.setEditDialogOpen}
          powerDialogOpen={admin.powerDialogOpen}
          setPowerDialogOpen={admin.setPowerDialogOpen}
          roomDialogOpen={admin.roomDialogOpen}
          setRoomDialogOpen={admin.setRoomDialogOpen}
          onProfilePatch={onProfilePatch}
        />
      )}

      <AlertSenderPopup
        profileId={profileId}
        profileName={profileName}
        profileAvatar={profileAvatar}
        open={alertOpen}
        onOpenChange={setAlertOpen}
      />
    </>
  );
}
