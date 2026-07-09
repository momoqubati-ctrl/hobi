import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { Bell } from "lucide-react";

interface AlertReceivedPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromUsername: string;
  fromAvatar: string;
  fromBanner?: string;
  fromGiftIcon?: string;
  fromPromotionIcon?: string;
  fromAvatarFrame?: string;
  message: string;
  timestamp: number;
  stackIndex?: number;
}

export function AlertReceivedPopup({ open, onOpenChange, fromUsername, fromAvatar, fromBanner, fromGiftIcon, fromPromotionIcon, fromAvatarFrame, message, timestamp, stackIndex = 0 }: AlertReceivedPopupProps) {
  const bannerUrl = fromBanner || "";
  const giftIconUrl = fromGiftIcon || "";
  const promotionIconUrl = fromPromotionIcon || "";
  const avatarFrameUrl = fromAvatarFrame || "";
  const offset = stackIndex * 60;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed left-4 translate-x-0 max-w-[300px] w-[300px] rounded-2xl border-none p-0 gap-0 overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.4)] data-[state=open]:slide-in-from-left-10 data-[state=closed]:slide-out-to-left-10 [&>button]:hidden"
        noOverlay
        style={{ top: `calc(40% + ${offset}px)` }}
        dir="ltr"
      >
        <DialogTitle className="sr-only">تنبيه جديد</DialogTitle>
        <DialogDescription className="sr-only">تم استلام تنبيه جديد</DialogDescription>

        <div className="bg-background px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="relative shrink-0 order-1">
              <img
                src={fromAvatar}
                alt={fromUsername}
                className="h-14 w-14 rounded-full object-cover shadow-lg ring-2 ring-border"
              />
              {avatarFrameUrl && (
                <img
                  src={avatarFrameUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full rounded-full pointer-events-none"
                />
              )}
              <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-amber-500 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                <Bell className="h-2 w-2 text-white fill-white" />
              </div>
            </div>

            <div className="flex items-center gap-1.5 min-w-0 flex-1 order-2">
              {promotionIconUrl && (
                <img src={promotionIconUrl} alt="" className="h-5 w-5 rounded object-contain shrink-0" title="أيقونة رتبة" />
              )}
              {giftIconUrl && (
                <img src={giftIconUrl} alt="" className="h-5 w-5 rounded object-contain shrink-0" title="أيقونة تميز" />
              )}
              {bannerUrl && (
                <img src={bannerUrl} alt="" className="h-5 max-w-[70px] rounded object-contain shrink-0" title="بنر" />
              )}
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-black text-foreground truncate">{fromUsername}</h4>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-muted/50 border border-border px-3 py-2.5 mb-3">
            <p className="text-xs font-bold text-foreground leading-relaxed text-center">{message}</p>
          </div>

          <button
            onClick={() => onOpenChange(false)}
            className="w-full h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-white text-xs font-black shadow transition hover:brightness-105"
          >
            اغلاق
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
