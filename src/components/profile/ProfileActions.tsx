import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import { MessageCircle, UserPlus, UserMinus, Heart, Bell, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertSenderPopup } from "./AlertSenderPopup";

interface ProfileActionsProps {
  profileId: string;
  profileName?: string;
  profileAvatar?: string;
  isSelf?: boolean;
  initialFollowing?: boolean;
  initialCooldownRemaining?: number;
  onFollowChange?: (following: boolean) => void;
  onFollowerCountChange?: (followerCount: number) => void;
  onLikeChange?: (likesCount: number) => void;
  onMessage?: (profileId: string) => void;
}

export function ProfileActions({ profileId, profileName = "عضو", profileAvatar = "/pic.png", isSelf = false, initialFollowing = false, initialCooldownRemaining = 0, onFollowChange, onFollowerCountChange, onLikeChange, onMessage }: ProfileActionsProps) {
  const socket = getSocket();
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(initialCooldownRemaining);
  const [likeLoading, setLikeLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        toast.success("تم الإعجاب");
      } else {
        toast.error(res.error || "حدث خطأ أثناء الإعجاب");
      }
    });
  }, [isSelf, socket, likeLoading, cooldownRemaining, profileId, onLikeChange]);

  const buttonClasses = "h-[42px] rounded-xl border border-border bg-card font-black text-xs flex items-center justify-center gap-1.5 transition-all hover:translate-y-[-1px] hover:shadow-md active:scale-[0.96]";
  const isCoolingDown = cooldownRemaining > 0;

  return (
    <>
      <footer className="sticky bottom-0 z-50 bg-background/95 backdrop-blur-md border-t border-border px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className={cn("grid gap-2", isSelf ? "grid-cols-3" : "grid-cols-4")}>
          <button
            onClick={() => onMessage?.(profileId)}
            className="h-[42px] rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-[0_8px_20px_rgba(37,99,235,0.32)] font-black text-xs flex items-center justify-center gap-1.5 transition-all hover:translate-y-[-1px] hover:brightness-105 hover:shadow-[0_8px_24px_rgba(37,99,235,0.42)] active:scale-[0.96]"
          >
            <MessageCircle className="h-4 w-4" />
            رسالة
          </button>
          {!isSelf && (
            <button
              onClick={handleFollow}
              disabled={loading}
              className={cn(
                buttonClasses,
                following
                  ? "border-red-200 bg-red-50 text-red-500 dark:bg-red-500/10 dark:border-red-500/30"
                  : "border-primary/30 bg-card text-foreground"
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : following ? (
                <UserMinus className="h-4 w-4 text-red-500" />
              ) : (
                <UserPlus className="h-4 w-4 text-primary" />
              )}
              {loading ? "جاري..." : following ? "إلغاء متابعة" : "متابعة"}
            </button>
          )}
          <button
            onClick={handleLike}
            disabled={isCoolingDown || likeLoading}
            className={cn(
              buttonClasses,
              isCoolingDown
                ? "text-rose-500 border-rose-200 bg-rose-50 dark:bg-rose-500/10 opacity-70"
                : "text-foreground"
            )}
          >
            {likeLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Heart className="h-4 w-4 transition-all" />
            )}
            {likeLoading
              ? "..."
              : isCoolingDown
                ? `${cooldownRemaining}ث`
                : "إعجاب"}
          </button>
          {!isSelf && (
            <button
              onClick={() => setAlertOpen(true)}
              className={cn(buttonClasses, "text-foreground")}
            >
              <Bell className="h-4 w-4" />
              تنبيه
            </button>
          )}
        </div>
      </footer>

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
