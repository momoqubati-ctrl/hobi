import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../ui/dialog";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";

interface AlertSenderPopupProps {
  profileId: string;
  profileName: string;
  profileAvatar: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlertSenderPopup({ profileId, profileName, profileAvatar, open, onOpenChange }: AlertSenderPopupProps) {
  const socket = getSocket();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    if (!socket || !message.trim() || sending) return;
    setSending(true);
    socket.emit("profile:sendAlert", { profileId, message: message.trim() }, (res: any) => {
      setSending(false);
      if (res.success) {
        toast.success("تم إرسال التنبيه بنجاح");
        setMessage("");
        onOpenChange(false);
      } else {
        toast.error(res.error || "حدث خطأ أثناء إرسال التنبيه");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px] rounded-3xl border-border bg-background p-0 gap-0 overflow-hidden" noOverlay dir="rtl">
        <DialogTitle className="sr-only">إرسال تنبيه</DialogTitle>
        <DialogDescription className="sr-only">اكتب رسالة تنبيه لإرسالها للمستخدم</DialogDescription>

        <div className="bg-gradient-to-br from-primary to-primary/80 px-5 py-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <img
              src={profileAvatar}
              alt={profileName}
              className="h-14 w-14 rounded-full border-2 border-white/30 object-cover shadow-lg"
            />
            <div>
              <h3 className="text-sm font-black text-white">{profileName}</h3>
              <p className="text-xs font-bold text-white/70">إرسال تنبيه</p>
            </div>
          </div>
        </div>

        <div className="p-5">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="اكتب رسالتك هنا..."
            maxLength={500}
            rows={4}
            className="w-full rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm font-bold text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition"
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs font-bold text-muted-foreground">{message.length}/500</span>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="flex-1 h-11 rounded-xl border border-border bg-card text-sm font-black text-muted-foreground transition hover:bg-muted/50"
          >
            إلغاء
          </button>
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="flex-1 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg transition hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {sending ? "جاري..." : "إرسال"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
