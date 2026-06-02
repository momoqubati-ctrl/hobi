import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import { MessageCircle, UserPlus, Heart, Bell, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileActionsProps {
  profileId: string;
  isSelf?: boolean;
  initialFollowing?: boolean;
  onFollowChange?: (following: boolean) => void;
  onMessage?: (profileId: string) => void;
}

export function ProfileActions({ profileId, isSelf = false, initialFollowing = false, onFollowChange, onMessage }: ProfileActionsProps) {
  const socket = getSocket();
  const [following, setFollowing] = useState(initialFollowing);
  const [loading, setLoading] = useState(false);
  const [isLiked, setIsLiked] = useState(false);

  useEffect(() => {
    setFollowing(initialFollowing);
  }, [initialFollowing, profileId]);

  const handleFollow = () => {
    if (isSelf || !socket || loading) return;
    setLoading(true);
    socket.emit("profile:follow", { profileId }, (res: any) => {
      setLoading(false);
      if (res.success) {
        setFollowing(Boolean(res.following));
        onFollowChange?.(Boolean(res.following));
        toast.success(res.following ? "تمت المتابعة بنجاح" : "تم إلغاء المتابعة");
      } else {
        toast.error(res.error || "حدث خطأ أثناء المتابعة");
      }
    });
  };

  const handleLike = () => {
    setIsLiked((prev) => !prev);
    toast.success(isLiked ? "تم إلغاء الإعجاب" : "تم الإعجاب");
  };

  const buttonClasses = "h-[42px] rounded-xl border border-border bg-card font-black text-xs flex items-center justify-center gap-1.5 transition-all hover:translate-y-[-1px] hover:shadow-md active:scale-[0.96]";

  return (
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
                ? "border-border bg-muted text-muted-foreground"
                : "border-primary/30 bg-card text-foreground"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className={cn("h-4 w-4", following ? "text-muted-foreground" : "text-primary")} />
            )}
            {loading ? "جاري..." : following ? "متابع" : "متابعة"}
          </button>
        )}
        <button
          onClick={handleLike}
          className={cn(buttonClasses, isLiked ? "text-rose-500 border-rose-200 bg-rose-50 dark:bg-rose-500/10" : "text-foreground")}
        >
          <Heart className={cn("h-4 w-4 transition-all", isLiked ? "fill-rose-500 scale-110" : "fill-transparent")} />
          {isLiked ? "معجب" : "إعجاب"}
        </button>
        <button className={cn(buttonClasses, "text-foreground")}>
          <Bell className="h-4 w-4" />
          تنبيه
        </button>
      </div>
    </footer>
  );
}
