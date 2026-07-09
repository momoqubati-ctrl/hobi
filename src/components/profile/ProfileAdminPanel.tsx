import { ShieldAlert, Edit2, UserMinus, MicOff, Mic, Settings } from "lucide-react";
import { Button } from "../ui/button";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import { useEffect, useState } from "react";

interface ProfileAdminPanelProps {
  profileId: string;
  currentRole: string;
  isMuted?: boolean;
  onProfilePatch?: (patch: any) => void;
}

export function ProfileAdminPanel({ profileId, currentRole, isMuted: initialMuted, onProfilePatch }: ProfileAdminPanelProps) {
  const socket = getSocket();
  const [isMuted, setIsMuted] = useState(initialMuted || false);

  useEffect(() => {
    setIsMuted(Boolean(initialMuted));
  }, [initialMuted, profileId]);

  const runAction = (action: string, value?: any, reason?: string) => {
    try {
      socket.emit("profile:adminAction", { profileId, action, value, reason }, (res: any) => {
        try {
          if (res?.success) {
            toast.success(res.notice || "تم تنفيذ الإجراء");
            if (action === "nick") onProfilePatch?.({ displayName: value });
            if (action === "message") onProfilePatch?.({ profile: { profileMsg: value } });
            if (action === "likes") onProfilePatch?.({ stats: { likes: Number(value) || 0 } });
            if (action === "site_badge") onProfilePatch?.({ profile: { siteBadge: value } });
            if (action === "delete_pic") onProfilePatch?.({ profile: { avatarUrl: "/pic.png" } });
            if (action === "global_mute") {
              setIsMuted(true);
              onProfilePatch?.({ profile: { muted: true } });
            }
            if (action === "room_unmute") {
              setIsMuted(false);
              onProfilePatch?.({ profile: { muted: false } });
            }
            if (action === "history") {
              const history = (res.history || []).map((item: any) => item.topic || item.username).filter(Boolean).join("\n");
              alert(history || "لا يوجد سجل أسماء لهذا العضو");
            }
          } else {
            toast.error(res?.error || "تعذر تنفيذ الإجراء");
          }
        } catch (e) {
          console.error("callback error:", e);
        }
      });
    } catch (e) {
      console.error("emit error:", e);
      toast.error("تعذر الاتصال بالخادم");
    }
  };

  const askText = (label: string, current = "") => {
    const value = window.prompt(label, current);
    return value === null ? undefined : value.trim();
  };

  return (
    <section className="rounded-3xl border border-red-200/80 bg-red-50/80 p-4 shadow-sm dark:border-red-500/20 dark:bg-red-500/10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-200">
          <ShieldAlert className="h-5 w-5" />
          <h3 className="text-sm font-black">أدوات الإدارة</h3>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black text-red-700 shadow-sm dark:bg-slate-950/40 dark:text-red-200">
          {currentRole || "member"} · {profileId}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const value = askText("اكتب النك الجديد");
            if (value) runAction("nick", value);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          <Edit2 className="ml-2 h-4 w-4" />
          تغيير النك
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const value = askText("اكتب الرتبة الجديدة");
            if (value) runAction("power", value);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          <Settings className="ml-2 h-4 w-4" />
          الصلاحيات
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => isMuted ? runAction("room_unmute", 0) : runAction("global_mute", 1, "إسكات عام من البروفايل")}
          className={`h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200 ${isMuted ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-200" : ""}`}
        >
          {isMuted ? <Mic className="ml-2 h-4 w-4" /> : <MicOff className="ml-2 h-4 w-4" />}
          {isMuted ? "الغاء الاسكات" : "اسكات عام"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm("هل تريد طرد هذا العضو؟")) runAction("kick", undefined, "طرد من البروفايل");
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          <UserMinus className="ml-2 h-4 w-4" />
          طرد نهائي
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const value = askText("رسالة الحالة الجديدة");
            if (value !== undefined) runAction("message", value);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          تعديل الحالة
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const value = askText("عدد الإعجابات");
            if (value !== undefined) runAction("likes", Number(value) || 0);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          تعديل اللايكات
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const value = askText("وسام الموقع");
            if (value !== undefined) runAction("site_badge", value);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          وسام الموقع
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction("history")}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          كشف النكات
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const value = askText("معرف الغرفة المطلوب نقل العضو إليها");
            if (value) runAction("room_move", value);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          سحب لغرفة
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const minutesStr = window.prompt("أدخل مدة حظر العضو من دخول الغرفة بالدقائق:");
            if (minutesStr === null) return;
            const minutes = parseInt(minutesStr.trim(), 10);
            if (isNaN(minutes) || minutes <= 0) {
              toast.error("يرجى إدخال مدة حظر صالحة بالدقائق (أكبر من 0)");
              return;
            }
            runAction("room_kick", minutes, `طرد مؤقت لمدة ${minutes} دقائق`);
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          طرد من الغرفة
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction("room_mute", 1)}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          كتم بالروم
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction("room_unmute", 0)}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          فك الكتم
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction("delete_pic")}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          مسح الصورة
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm("هل تريد حظر هذا العضو؟")) runAction("ban", undefined, "حظر من البروفايل");
          }}
          className="h-11 rounded-2xl border-red-200 bg-white text-xs font-black text-red-700 hover:bg-red-50 dark:border-red-500/20 dark:bg-slate-950/40 dark:text-red-200"
        >
          حظر نهائي
        </Button>
      </div>
    </section>
  );
}
