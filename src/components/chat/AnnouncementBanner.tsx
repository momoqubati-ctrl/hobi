import { AlertCircle, Loader2, Megaphone, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAnnouncementInbox } from "@/hooks/useAnnouncementInbox";
import type { AnnouncementType } from "@/lib/announcements";

const ANNOUNCEMENT_LABELS: Record<AnnouncementType, string> = {
  all: "إعلان عام",
  ranked: "إعلان للسوابر",
  room: "إعلان خاص",
};

export default function AnnouncementBanner() {
  const {
    announcements,
    dismissingIds,
    isLoading,
    error,
    dismiss,
    retry,
  } = useAnnouncementInbox();
  const current = announcements[0];

  if (!current && error) {
    return (
      <div
        className="fixed left-3 right-3 top-3 z-[60] mx-auto flex max-w-3xl items-center gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3 text-sm shadow-lg rtl"
        role="alert"
      >
        <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <p className="flex-1">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void retry()} disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (!current) return null;

  const isDismissing = dismissingIds.has(current.id);

  return (
    <aside
      className="fixed left-3 right-3 top-3 z-[60] mx-auto max-h-[45dvh] max-w-3xl overflow-y-auto rounded-lg border border-primary/25 bg-card shadow-lg rtl"
      aria-label="إعلان وارد"
      aria-live="polite"
    >
      <div className="flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
        <Avatar className="mt-0.5 h-10 w-10 shrink-0">
          <AvatarImage
            src={current.senderAvatarUrl || "/pic.png"}
            alt=""
            referrerPolicy="no-referrer"
          />
          <AvatarFallback aria-hidden="true">
            {current.senderName.trim().slice(0, 1) || "؟"}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Megaphone className="h-4 w-4 text-primary" aria-hidden="true" />
            <strong className="text-sm font-bold">{ANNOUNCEMENT_LABELS[current.type]}</strong>
            <span className="text-xs text-muted-foreground">
              من {current.senderName}
            </span>
            {announcements.length > 1 && (
              <span className="text-xs text-muted-foreground">
                ({1} من {announcements.length})
              </span>
            )}
          </div>
          <p className="max-h-[28dvh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
            {current.message}
          </p>
          {error && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="إغلاق الإعلان"
          onClick={() => void dismiss(current.id)}
          disabled={isDismissing}
        >
          {isDismissing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-5 w-5" aria-hidden="true" />
          )}
        </Button>
      </div>
    </aside>
  );
}
