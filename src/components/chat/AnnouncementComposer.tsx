import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2, Megaphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRealtimeStore } from "@/lib/realtime-store";
import {
  getAllowedAnnouncementTypes,
  getAnnouncementSubmissionKey,
  sendAnnouncement,
  validateAnnouncementDraft,
  type AnnouncementDraft,
  type AnnouncementSubmissionKey,
  type AnnouncementType,
} from "@/lib/announcements";
import { showError, showSuccess } from "@/utils/toast";

const ANNOUNCEMENT_LABELS: Record<AnnouncementType, string> = {
  all: "إعلان عام",
  ranked: "إعلان للسوابر",
  room: "إعلان خاص لغرفة",
};

interface AnnouncementComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AnnouncementComposer({
  open,
  onOpenChange,
}: AnnouncementComposerProps) {
  const permissions = useRealtimeStore((state) => state.userPermissions);
  const rooms = useRealtimeStore((state) => state.rooms);
  const allowedTypes = useMemo(
    () => getAllowedAnnouncementTypes(permissions),
    [permissions],
  );
  const [type, setType] = useState<AnnouncementType>("all");
  const [roomId, setRoomId] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const submissionKey = useRef<AnnouncementSubmissionKey | null>(null);

  const availableRooms = useMemo(
    () => rooms.filter((room) => typeof room.id === "string" && room.id.trim()),
    [rooms],
  );

  useEffect(() => {
    if (!open) return;
    setType(allowedTypes[0] ?? "all");
    setRoomId("");
    setMessage("");
    setErrorMessage("");
    submissionKey.current = null;
  }, [open, allowedTypes]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (!allowedTypes.includes(type)) {
      const error = "لا تملك صلاحية هذا النوع من الإعلانات";
      setErrorMessage(error);
      showError(error);
      return;
    }

    const draft: AnnouncementDraft = {
      type,
      message,
      ...(type === "room" ? { roomId } : {}),
    };
    const validationError = validateAnnouncementDraft(draft);
    if (validationError) {
      setErrorMessage(validationError);
      showError(validationError);
      return;
    }

    const requestKey = getAnnouncementSubmissionKey(draft, submissionKey.current);
    submissionKey.current = requestKey;
    setIsSending(true);

    try {
      const receipt = await sendAnnouncement(draft, requestKey.key);
      submissionKey.current = null;
      showSuccess(`تم إرسال الإعلان إلى ${receipt.recipientCount} عضو`);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر إرسال الإعلان";
      setErrorMessage(message);
      showError(message);
    } finally {
      setIsSending(false);
    }
  };

  if (allowedTypes.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />
            إرسال إعلان
          </DialogTitle>
          <DialogDescription>
            اختر الجمهور واكتب الإعلان. سيبقى ظاهرًا للمستلمين حتى يغلقوه.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="announcement-type">نوع الإعلان</Label>
            <Select
              value={type}
              onValueChange={(value) => {
                const nextType = allowedTypes.find((option) => option === value);
                if (!nextType) return;
                setType(nextType);
                setErrorMessage("");
              }}
              disabled={isSending}
            >
              <SelectTrigger id="announcement-type" aria-label="نوع الإعلان">
                <SelectValue placeholder="اختر نوع الإعلان" />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ANNOUNCEMENT_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === "room" && (
            <div className="space-y-2">
              <Label htmlFor="announcement-room">الغرفة</Label>
              <Select
                value={roomId}
                onValueChange={(value) => {
                  setRoomId(value);
                  setErrorMessage("");
                }}
                disabled={isSending || availableRooms.length === 0}
              >
                <SelectTrigger id="announcement-room" aria-label="غرفة الإعلان">
                  <SelectValue placeholder="اختر غرفة" />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((room) => (
                    <SelectItem key={room.id} value={room.id}>
                      {typeof room.name === "string" && room.name.trim()
                        ? room.name
                        : room.slug || room.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableRooms.length === 0 && (
                <p className="text-sm text-muted-foreground" role="status">
                  لا توجد غرف متاحة للاختيار حاليًا.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="announcement-message">نص الإعلان</Label>
            <Textarea
              id="announcement-message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setErrorMessage("");
              }}
              placeholder="اكتب نص الإعلان هنا"
              maxLength={1000}
              rows={5}
              disabled={isSending}
              aria-describedby="announcement-message-count"
              required
            />
            <p
              id="announcement-message-count"
              className="text-xs text-muted-foreground"
              aria-live="polite"
            >
              {message.length}/1000
            </p>
          </div>

          {errorMessage && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {errorMessage}
            </p>
          )}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="submit" disabled={isSending}>
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Megaphone className="h-4 w-4" aria-hidden="true" />
              )}
              {isSending ? "جارٍ الإرسال..." : "إرسال الإعلان"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSending}
              onClick={() => handleOpenChange(false)}
            >
              إلغاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
