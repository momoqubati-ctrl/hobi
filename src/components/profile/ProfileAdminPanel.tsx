import {
  ShieldAlert,
  Edit2,
  UserMinus,
  MicOff,
  Mic,
  Settings,
  DoorOpen,
  Loader2,
  ChevronUp,
  Trash2,
  Calendar,
  Shield,
  User,
  MessageSquare,
  Heart,
  Save,
  Award,
  History,
} from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { getSocket } from "@/lib/socket";
import { toast } from "sonner";
import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useRealtimeStore } from "@/lib/realtime-store";
import { canRunProfileAdminAction, ProfileAdminAction } from "@/lib/profileAdminPermissions";

export interface ProfileAdminPanelProps {
  profileId: string;
  currentRole?: string;
  isMuted?: boolean;
  currentDisplayName?: string;
  currentProfileMsg?: string;
  currentLikes?: number;
  onProfilePatch?: (patch: any) => void;
  isSelf?: boolean;
}

export const ROLE_RANK_MAP: Record<string, number> = {
  owner: 100000,
  مالك: 100000,
  ispower: 99999,
  admin: 9000,
  ادمن: 8000,
  أدمن: 8000,
  moderator: 5000,
  سوبر: 6000,
  مشرف: 5000,
  member: 1000,
  عضو: 1000,
  guest: 0,
  زائر: 0,
};

export function useProfileAdmin({
  profileId,
  isMuted: initialMuted = false,
  onProfilePatch,
}: {
  profileId: string;
  isMuted?: boolean;
  onProfilePatch?: (patch: any) => void;
}) {
  const socket = getSocket();
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [powerDialogOpen, setPowerDialogOpen] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);

  useEffect(() => {
    setIsMuted(Boolean(initialMuted));
  }, [initialMuted, profileId]);

  const runAction = useCallback(
    (action: string, value?: any, reason?: string) => {
      try {
        console.log("[CLIENT_ADMIN] emitting profile:adminAction", { profileId, action, value, reason });
        socket.emit("profile:adminAction", { profileId, action, value, reason }, (res: any) => {
          console.log("[CLIENT_ADMIN] callback", { profileId, action, res });
          try {
            if (res?.success) {
              toast.success(res.notice || "تم تنفيذ الإجراء بنجاح");
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
    },
    [socket, profileId, onProfilePatch]
  );

  const askText = useCallback((label: string, current = "") => {
    const value = window.prompt(label, current);
    return value === null ? undefined : value.trim();
  }, []);

  return {
    isMuted,
    setIsMuted,
    editDialogOpen,
    setEditDialogOpen,
    powerDialogOpen,
    setPowerDialogOpen,
    roomDialogOpen,
    setRoomDialogOpen,
    runAction,
    askText,
  };
}

interface ProfileAdminMenuItemsProps {
  currentRole?: string;
  isMuted?: boolean;
  isSelf?: boolean;
  canManageRoles?: boolean;
  onOpenEdit: () => void;
  onOpenPower: () => void;
  onOpenRoom: () => void;
  runAction: (action: string, value?: any, reason?: string) => void;
  askText: (label: string, current?: string) => string | undefined;
}

export function ProfileAdminMenuItems({
  currentRole,
  isMuted = false,
  isSelf = false,
  canManageRoles = false,
  onOpenEdit,
  onOpenPower,
  onOpenRoom,
  runAction,
  askText,
}: ProfileAdminMenuItemsProps) {
  const permissions = useRealtimeStore((state) => state.userPermissions);
  const can = (action: ProfileAdminAction) => canRunProfileAdminAction(permissions, action);

  return (
    <>
      <DropdownMenuSeparator className="bg-border/60 dark:bg-red-500/20 my-1.5" />

      {/* عنوان قسم أدوات الإدارة مع الرتبة */}
      <div className="px-3 py-1.5 flex items-center justify-between text-xs font-black text-red-600 dark:text-red-400 select-none">
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-500" />
          <span>أدوات الإدارة والتحكم</span>
        </span>
        <span className="text-[10px] bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full font-mono">
          {currentRole || "عضو"}
        </span>
      </div>

      {/* 1. تعديل البيانات */}
      {can("nick") && <DropdownMenuItem
        onClick={onOpenEdit}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-sky-600 hover:text-sky-700 focus:text-sky-700 hover:bg-sky-50 focus:bg-sky-50 dark:text-sky-400 dark:hover:text-sky-300 dark:focus:text-sky-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <Edit2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <span>تعديل البيانات</span>
      </DropdownMenuItem>}

      {/* 2. الصلاحيات والترقية - تظهر فقط للمصرح لهم ولغير النفس */}
      {canManageRoles && !isSelf && can("power") && (
        <DropdownMenuItem
          onClick={onOpenPower}
          className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-amber-600 hover:text-amber-700 focus:text-amber-700 hover:bg-amber-50 focus:bg-amber-50 dark:text-amber-400 dark:hover:text-amber-300 dark:focus:text-amber-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
        >
          <Settings className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span>الصلاحيات والترقية</span>
        </DropdownMenuItem>
      )}

      {/* 3. سحب إلى غرفة */}
      {can("pull_to_room") && <DropdownMenuItem
        onClick={onOpenRoom}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-emerald-600 hover:text-emerald-700 focus:text-emerald-700 hover:bg-emerald-50 focus:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:focus:text-emerald-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <DoorOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span>سحب إلى غرفة</span>
      </DropdownMenuItem>}

      {/* 4. اسكات عام / فك الاسكات (فك الايسكات العام لا يمس الكتم الغرفي) */}
      {can(isMuted ? "global_unmute" : "global_mute") && <DropdownMenuItem
        onClick={() => (isMuted ? runAction("global_unmute", 0) : runAction("global_mute", 1, "إسكات عام من البروفايل"))}
        className={cn(
          "flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer font-bold text-xs transition-colors",
          isMuted
            ? "text-emerald-600 hover:text-emerald-700 focus:text-emerald-700 hover:bg-emerald-50 focus:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:focus:text-emerald-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80"
            : "text-orange-600 hover:text-orange-700 focus:text-orange-700 hover:bg-orange-50 focus:bg-orange-50 dark:text-orange-400 dark:hover:text-orange-300 dark:focus:text-orange-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80"
        )}
      >
        {isMuted ? (
          <Mic className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <MicOff className="h-4 w-4 text-orange-600 dark:text-orange-400" />
        )}
        <span>{isMuted ? "إلغاء الإسكات العام" : "إسكات عام"}</span>
      </DropdownMenuItem>}

      {/* 5. كتم بالروم */}
      {can("room_mute") && <DropdownMenuItem
        onClick={() => runAction("room_mute", 1)}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-cyan-600 hover:text-cyan-700 focus:text-cyan-700 hover:bg-cyan-50 focus:bg-cyan-50 dark:text-cyan-400 dark:hover:text-cyan-300 dark:focus:text-cyan-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <MicOff className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
        <span>كتم بالروم</span>
      </DropdownMenuItem>}

      {/* 6. فك الكتم */}
      {can("room_unmute") && <DropdownMenuItem
        onClick={() => runAction("room_unmute", 0)}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-cyan-600 hover:text-cyan-700 focus:text-cyan-700 hover:bg-cyan-50 focus:bg-cyan-50 dark:text-cyan-400 dark:hover:text-cyan-300 dark:focus:text-cyan-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <Mic className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
        <span>فك كتم الروم</span>
      </DropdownMenuItem>}

      {/* 7. طرد من الغرفة */}
      {can("room_kick") && <DropdownMenuItem
        onClick={() => {
          setTimeout(() => {
            const minutesStr = window.prompt("أدخل مدة حظر العضو من دخول الغرفة بالدقائق:");
            if (minutesStr === null) return;
            const minutes = parseInt(minutesStr.trim(), 10);
            if (isNaN(minutes) || minutes <= 0) {
              toast.error("يرجى إدخال مدة حظر صالحة بالدقائق (أكبر من 0)");
              return;
            }
            runAction("room_kick", minutes, `طرد مؤقت لمدة ${minutes} دقائق`);
          }, 50);
        }}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-purple-600 hover:text-purple-700 focus:text-purple-700 hover:bg-purple-50 focus:bg-purple-50 dark:text-purple-400 dark:hover:text-purple-300 dark:focus:text-purple-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <DoorOpen className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        <span>طرد من الغرفة</span>
      </DropdownMenuItem>}

      {/* 8. طرد من الموقع */}
      {can("kick") && <DropdownMenuItem
        onClick={() => {
          setTimeout(() => {
            if (window.confirm("هل تريد طرد هذا العضو من الموقع؟")) {
              runAction("kick", undefined, "طرد من الموقع");
            }
          }, 50);
        }}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-rose-600 hover:text-rose-700 focus:text-rose-700 hover:bg-rose-50 focus:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:focus:text-rose-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <UserMinus className="h-4 w-4 text-rose-600 dark:text-rose-400" />
        <span>طرد من الموقع</span>
      </DropdownMenuItem>}

      {/* 9. وسام الموقع */}
      {can("site_badge") && <DropdownMenuItem
        onClick={() => {
          setTimeout(() => {
            const value = askText("وسام الموقع");
            if (value !== undefined) runAction("site_badge", value);
          }, 50);
        }}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-amber-600 hover:text-amber-700 focus:text-amber-700 hover:bg-amber-50 focus:bg-amber-50 dark:text-yellow-400 dark:hover:text-yellow-300 dark:focus:text-yellow-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <Award className="h-4 w-4 text-amber-600 dark:text-yellow-400" />
        <span>وسام الموقع</span>
      </DropdownMenuItem>}

      {/* 10. كشف النكات */}
      {can("history") && <DropdownMenuItem
        onClick={() => runAction("history")}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-indigo-600 hover:text-indigo-700 focus:text-indigo-700 hover:bg-indigo-50 focus:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:focus:text-indigo-300 dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <History className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <span>كشف النكات</span>
      </DropdownMenuItem>}

      {/* 11. مسح الصورة */}
      {can("delete_pic") && <DropdownMenuItem
        onClick={() => {
          setTimeout(() => {
            if (window.confirm("هل تريد حذف صورة هذا العضو وإعادتها للافتراضية؟")) {
              runAction("delete_pic");
            }
          }, 50);
        }}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-slate-600 hover:text-slate-800 focus:text-slate-800 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:focus:text-white dark:hover:bg-slate-800/80 dark:focus:bg-slate-800/80 font-bold text-xs transition-colors"
      >
        <Trash2 className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        <span>مسح الصورة</span>
      </DropdownMenuItem>}

      {/* 12. حظر نهائي */}
      {can("ban") && <DropdownMenuItem
        onClick={() => {
          setTimeout(() => {
            if (window.confirm("هل تريد حظر هذا العضو نهائياً؟")) {
              runAction("ban", undefined, "حظر من البروفايل");
            }
          }, 50);
        }}
        className="flex items-center gap-2.5 py-2 px-3 rounded-xl cursor-pointer text-red-600 hover:text-red-700 focus:text-red-700 hover:bg-red-50 focus:bg-red-50 dark:text-red-500 dark:hover:text-red-400 dark:focus:text-red-400 dark:hover:bg-red-950/50 dark:focus:bg-red-950/50 font-black text-xs transition-colors"
      >
        <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-500" />
        <span>حظر نهائي</span>
      </DropdownMenuItem>}
    </>
  );
}

interface ProfileAdminDialogsProps {
  profileId: string;
  currentRole: string;
  currentDisplayName?: string;
  currentProfileMsg?: string;
  currentLikes?: number;
  editDialogOpen: boolean;
  setEditDialogOpen: (open: boolean) => void;
  powerDialogOpen: boolean;
  setPowerDialogOpen: (open: boolean) => void;
  roomDialogOpen: boolean;
  setRoomDialogOpen: (open: boolean) => void;
  onProfilePatch?: (patch: any) => void;
}

export function ProfileAdminDialogs({
  profileId,
  currentRole,
  currentDisplayName,
  currentProfileMsg,
  currentLikes,
  editDialogOpen,
  setEditDialogOpen,
  powerDialogOpen,
  setPowerDialogOpen,
  roomDialogOpen,
  setRoomDialogOpen,
  onProfilePatch,
}: ProfileAdminDialogsProps) {
  const socket = getSocket();
  const permissions = useRealtimeStore((state) => state.userPermissions);
  const canEditProfile = canRunProfileAdminAction(permissions, "nick") ||
    canRunProfileAdminAction(permissions, "message");
  const canEditLikes = canRunProfileAdminAction(permissions, "likes");
  const canAssignPower = canRunProfileAdminAction(permissions, "power");
  const canPullToRoom = canRunProfileAdminAction(permissions, "pull_to_room");

  // Edit details states
  const [nickValue, setNickValue] = useState("");
  const [msgValue, setMsgValue] = useState("");
  const [likesValue, setLikesValue] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Roles states
  const [roleList, setRoleList] = useState<any[]>([]);
  const [roleListLoading, setRoleListLoading] = useState(false);
  const [roleFetchError, setRoleFetchError] = useState("");
  const [selectedRoleLegacyName, setSelectedRoleLegacyName] = useState("");
  const [selectedRoleDisplayName, setSelectedRoleDisplayName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Rooms states
  const [rooms, setRooms] = useState<any[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [pullingRoomId, setPullingRoomId] = useState<string | null>(null);

  // تحميل بيانات تعديل العضو عند فتح نافذة التعديل
  useEffect(() => {
    if (editDialogOpen) {
      setNickValue(currentDisplayName || "");
      setMsgValue(currentProfileMsg || "");
      setLikesValue(currentLikes !== undefined ? String(currentLikes) : "");
      setEditLoading(false);
    }
  }, [editDialogOpen, currentDisplayName, currentProfileMsg, currentLikes]);

  // جلب قائمة الرتب عند فتح نافذة الصلاحيات والترقية
  useEffect(() => {
    if (!powerDialogOpen || !canAssignPower) return;

    setSelectedRoleLegacyName("");
    setSelectedRoleDisplayName("");
    setStartDate("");
    setEndDate("");
    setRoleListLoading(true);
    setRoleFetchError("");
    setRoleList([]);

    const token =
      localStorage.getItem("authToken") ||
      localStorage.getItem("auth_token") ||
      "";

    fetch("/api/admin/roles", {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || !data.success) {
          throw new Error(data.message || `خطأ في تحميل الرتب (${r.status})`);
        }
        return data;
      })
      .then((data) => {
        const rawUser = localStorage.getItem("user") || localStorage.getItem("auth_user");
        const actorUser = rawUser ? JSON.parse(rawUser) : null;
        const actorRole = String(actorUser?.role || "").toLowerCase().trim();
        const actorPower = String(actorUser?.power || "").toLowerCase().trim();
        const actorUsername = String(actorUser?.username || "").toLowerCase().trim();

        const isOwner = Boolean(
          data.isOwner ||
          (data.actorRank && data.actorRank >= 99999) ||
          actorRole === "owner" ||
          actorRole === "ispower" ||
          actorRole === "مالك" ||
          actorPower === "owner" ||
          actorPower === "ispower" ||
          actorPower === "مالك" ||
          actorUsername === "safarihost"
        );

        const actorRank = data.actorRank || (isOwner ? 100000 : (ROLE_RANK_MAP[actorRole] || ROLE_RANK_MAP[actorPower] || 9000));

        const filtered = (data.roles || []).filter((r: any) => {
          if (r.is_active === false) return false;
          // المالك يملك حق إسناد جميع الرتب المفعلة في النظام
          if (isOwner) return true;
          const legacy = (r.legacy_name || r.name || "").toLowerCase().trim();
          const rank = r.rank ?? ROLE_RANK_MAP[legacy] ?? 0;
          return rank < actorRank;
        });
        setRoleList(filtered);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "تعذر تحميل قائمة الرتب";
        console.error("[ProfileAdminDialogs] Error fetching roles:", err);
        setRoleFetchError(msg);
        toast.error(msg);
      })
      .finally(() => setRoleListLoading(false));
  }, [powerDialogOpen, canAssignPower]);

  // جلب قائمة الغرف عند فتح نافذة السحب إلى غرفة
  useEffect(() => {
    if (!roomDialogOpen || !canPullToRoom) return;

    setRoomsLoading(true);
    setRooms([]);
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRooms(data.rooms || []);
      })
      .catch(() => toast.error("تعذر تحميل الغرف"))
      .finally(() => setRoomsLoading(false));
  }, [roomDialogOpen, canPullToRoom]);

  return (
    <>
      {/* 1. دايلوج تعديل البيانات */}
      <Dialog
        open={editDialogOpen && (canEditProfile || canEditLikes)}
        onOpenChange={(open) => setEditDialogOpen(open && (canEditProfile || canEditLikes))}
      >
        <DialogContent className="sm:max-w-md bg-card border-border text-card-foreground shadow-2xl dark:bg-[#0b1226] dark:border-blue-900/50 dark:text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-foreground dark:text-white">تعديل بيانات العضو</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {canEditProfile && <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-muted-foreground dark:text-slate-300">
                <User className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
                الاسم المستعار
              </label>
              <input
                type="text"
                value={nickValue}
                onChange={(e) => setNickValue(e.target.value)}
                placeholder="أدخل الاسم الجديد"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary dark:border-blue-900/40 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>}
            {canEditProfile && <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-muted-foreground dark:text-slate-300">
                <MessageSquare className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400" />
                رسالة الحالة
              </label>
              <input
                type="text"
                value={msgValue}
                onChange={(e) => setMsgValue(e.target.value)}
                placeholder="أدخل رسالة الحالة الجديدة"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary dark:border-blue-900/40 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>}
            {canEditLikes && <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-muted-foreground dark:text-slate-300">
                <Heart className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
                عدد الإعجابات
              </label>
              <input
                type="number"
                value={likesValue}
                onChange={(e) => setLikesValue(e.target.value)}
                placeholder="0"
                min="0"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary dark:border-blue-900/40 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>}
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={editLoading}
              onClick={async () => {
                if (!canEditProfile && !canEditLikes) return;
                setEditLoading(true);
                let errors: string[] = [];

                const doEmit = (act: string, val: any) =>
                  new Promise<void>((resolve) => {
                    if (!canRunProfileAdminAction(permissions, act)) {
                      errors.push(`لا تملك صلاحية تنفيذ ${act}`);
                      resolve();
                      return;
                    }
                    socket.emit(
                      "profile:adminAction",
                      { profileId, action: act, value: val, reason: "" },
                      (res: any) => {
                        if (res?.success) {
                          if (act === "nick") onProfilePatch?.({ displayName: val });
                          if (act === "message") onProfilePatch?.({ profile: { profileMsg: val } });
                          if (act === "likes") onProfilePatch?.({ stats: { likes: Number(val) || 0 } });
                        } else {
                          errors.push(res?.error || `فشل ${act}`);
                        }
                        resolve();
                      }
                    );
                  });

                const tasks: Promise<void>[] = [];
                if (canEditProfile && nickValue.trim()) tasks.push(doEmit("nick", nickValue.trim()));
                if (canEditProfile && msgValue.trim()) tasks.push(doEmit("message", msgValue.trim()));
                if (canEditLikes && likesValue) tasks.push(doEmit("likes", Number(likesValue) || 0));

                if (tasks.length === 0) {
                  toast.error("يرجى إدخال قيمة واحدة على الأقل");
                  setEditLoading(false);
                  return;
                }

                await Promise.all(tasks);
                setEditLoading(false);

                if (errors.length === 0) {
                  toast.success("تم تحديث البيانات بنجاح");
                  setEditDialogOpen(false);
                } else {
                  toast.error(errors[0]);
                }
              }}
              className="flex-1 rounded-xl bg-primary hover:bg-primary/90 text-xs font-black text-primary-foreground"
            >
              {editLoading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
              حفظ التغييرات
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 2. دايلوج الصلاحيات والترقية */}
      <Dialog
        open={powerDialogOpen && canAssignPower}
        onOpenChange={(open) => setPowerDialogOpen(open && canAssignPower)}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md bg-card border-border text-card-foreground shadow-2xl dark:bg-[#0b1226] dark:border-blue-900/50 dark:text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-foreground dark:text-white">تعديل الصلاحيات والترقية</DialogTitle>
          </DialogHeader>
          {roleListLoading ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              <span className="text-xs text-muted-foreground font-medium">جاري تحميل الرتب...</span>
            </div>
          ) : roleFetchError ? (
            <div className="py-6 text-center text-xs text-rose-500 font-medium">
              {roleFetchError}
            </div>
          ) : (
            <div className="grid gap-4 py-1">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-muted-foreground dark:text-slate-300">اختر الرتبة المطلوبة</label>
                <div className="grid gap-1.5 max-h-52 overflow-y-auto pr-1">
                  {/* زر إزالة الترقية */}
                  <Button
                    type="button"
                    variant={selectedRoleLegacyName === "" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setSelectedRoleLegacyName("");
                      setSelectedRoleDisplayName("");
                    }}
                    className={`h-10 justify-start rounded-xl px-3 text-xs font-bold ${
                      selectedRoleLegacyName === ""
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "border-red-500/30 text-red-600 bg-red-50/50 hover:bg-red-100 dark:text-red-400 dark:bg-red-950/20 dark:hover:bg-red-950/40"
                    }`}
                  >
                    <Trash2 className="ml-2 h-4 w-4" />
                    إزالة الترقية (إعادة كعضو عادي)
                  </Button>
                  {roleList.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground dark:text-slate-400 font-medium">
                      لا توجد رتب أدنى من رتبتك الحالية لإسنادها
                    </div>
                  ) : (
                    roleList.map((role) => {
                      const roleKey = role.legacy_name || role.name;
                      const isSelected = selectedRoleLegacyName === roleKey;
                      const roleDisplay = role.name || role.legacy_name;
                      const roleRank = role.rank ?? ROLE_RANK_MAP[(role.legacy_name || "").toLowerCase()] ?? 0;
                      return (
                        <Button
                          key={role.id}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            setSelectedRoleLegacyName(roleKey);
                            setSelectedRoleDisplayName(roleDisplay);
                          }}
                          className={`h-10 justify-start rounded-xl px-3 text-xs font-bold transition-all ${
                            isSelected
                              ? "bg-amber-600 text-white hover:bg-amber-700 shadow-sm"
                              : "border-border text-foreground bg-card hover:bg-muted dark:border-blue-900/40 dark:text-slate-200 dark:bg-slate-900/60 dark:hover:bg-slate-800"
                          }`}
                        >
                          <Shield className="ml-2 h-4 w-4 text-amber-500 dark:text-amber-400" />
                          <span>{roleDisplay}</span>
                          <span className="mr-auto text-[10px] opacity-60">
                            ({roleRank})
                          </span>
                        </Button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground dark:text-slate-300">
                    <Calendar className="ml-1 inline h-3 w-3 text-primary dark:text-blue-400" />
                    تاريخ البدء (اختياري)
                  </label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary dark:border-blue-900/40 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground dark:text-slate-300">
                    <Calendar className="ml-1 inline h-3 w-3 text-primary dark:text-blue-400" />
                    تاريخ الانتهاء (اختياري)
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary dark:border-blue-900/40 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => {
                    if (!canAssignPower) return;
                    const powerVal = selectedRoleLegacyName || "";
                    socket.emit(
                      "profile:adminAction",
                      {
                        profileId,
                        action: "power",
                        value: powerVal,
                        displayName: powerVal ? selectedRoleDisplayName || powerVal : "",
                        startDate: startDate || undefined,
                        endDate: endDate || undefined,
                        reason: "",
                      },
                      (res: any) => {
                        try {
                          if (res?.success) {
                            toast.success(res.notice || "تم تطبيق الترقية بنجاح");
                            if (onProfilePatch) {
                              onProfilePatch({
                                profile: {
                                  power: powerVal,
                                  roleIconUrl: res.iconUrl || "",
                                },
                                role: res.role || selectedRoleDisplayName || "عضو",
                              });
                            }
                          } else {
                            toast.error(res?.error || "تعذر تنفيذ الإجراء");
                          }
                        } catch (e) {
                          console.error("callback error:", e);
                        }
                      }
                    );
                    setPowerDialogOpen(false);
                  }}
                  className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-xs font-black text-white"
                >
                  <ChevronUp className="ml-2 h-4 w-4" />
                  {selectedRoleLegacyName
                    ? `تثبيت رتبة: ${selectedRoleDisplayName || selectedRoleLegacyName}`
                    : "إزالة الترقية"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 3. دايلوج سحب إلى غرفة */}
      <Dialog
        open={roomDialogOpen && canPullToRoom}
        onOpenChange={(open) => setRoomDialogOpen(open && canPullToRoom)}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md bg-card border-border text-card-foreground shadow-2xl dark:bg-[#0b1226] dark:border-blue-900/50 dark:text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-foreground dark:text-white">اختر الغرفة لسحب العضو إليها</DialogTitle>
          </DialogHeader>
          {roomsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            </div>
          ) : rooms.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground dark:text-slate-400">لا توجد غرف متاحة حالياً</p>
          ) : (
            <div className="grid gap-2 max-h-72 overflow-y-auto pr-1">
              {rooms.map((room) => (
                <Button
                  key={room.id || room.slug}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pullingRoomId === (room.id || room.slug)}
                  onClick={async () => {
                    if (!canPullToRoom) return;
                    const roomId = room.id || room.slug;
                    if (!roomId) return;
                    setPullingRoomId(roomId);
                    socket.emit("profile:adminAction", { profileId, action: "pull_to_room", value: roomId }, (res: any) => {
                      if (res?.success) {
                        toast.success(res.notice || "تم سحب العضو للغرفة بنجاح");
                      } else {
                        toast.error(res?.error || "فشل سحب العضو للغرفة");
                      }
                    });
                    await new Promise((r) => setTimeout(r, 200));
                    setPullingRoomId(null);
                    setRoomDialogOpen(false);
                  }}
                  className="h-auto justify-start rounded-xl border-border bg-card hover:bg-muted text-foreground px-3 py-2.5 text-right text-xs dark:border-blue-900/40 dark:bg-slate-900/60 dark:hover:bg-slate-800 dark:text-slate-100"
                >
                  <div className="flex w-full items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted border border-border dark:bg-slate-800 dark:border-white/5">
                      {room.image ? (
                        <img src={room.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <DoorOpen className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                      )}
                    </div>
                    <div className="flex-1 text-right">
                      <div className="font-bold text-foreground dark:text-slate-100">{room.name}</div>
                      <div className="text-[11px] text-muted-foreground dark:text-slate-400">
                        {room.members ?? 0} متواجد
                        {pullingRoomId === (room.id || room.slug) ? " - جاري السحب..." : ""}
                      </div>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// التصدير القديم للتوافق في حال تم استدعاؤه كلوحة كاملة
export function ProfileAdminPanel(props: ProfileAdminPanelProps) {
  const permissions = useRealtimeStore((state) => state.userPermissions);
  const admin = useProfileAdmin({
    profileId: props.profileId,
    isMuted: props.isMuted,
    onProfilePatch: props.onProfilePatch,
  });

  return (
    <>
      <section className="rounded-2xl border border-red-500/30 bg-card/90 p-3 shadow-xs dark:bg-[#0b1226]/90 backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="h-4 w-4" />
            <h3 className="text-xs font-black">أدوات الإدارة</h3>
          </div>
          <span className="rounded-full bg-red-100 dark:bg-red-950/60 border border-red-300 dark:border-red-500/30 px-2 py-0.5 text-[10px] font-mono text-red-700 dark:text-red-300">
            {props.currentRole || "member"} · {props.profileId}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(canRunProfileAdminAction(permissions, "nick") || canRunProfileAdminAction(permissions, "message") || canRunProfileAdminAction(permissions, "likes")) && <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => admin.setEditDialogOpen(true)}
            className="h-10 rounded-xl border-border bg-card text-xs font-bold text-foreground hover:bg-muted dark:border-red-500/20 dark:bg-slate-900/60 dark:text-red-300 dark:hover:bg-slate-800"
          >
            <Edit2 className="ml-1.5 h-3.5 w-3.5" />
            تعديل البيانات
          </Button>
          </>}
          {canRunProfileAdminAction(permissions, "power") && <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => admin.setPowerDialogOpen(true)}
            className="h-10 rounded-xl border-border bg-card text-xs font-bold text-foreground hover:bg-muted dark:border-red-500/20 dark:bg-slate-900/60 dark:text-red-300 dark:hover:bg-slate-800"
          >
            <Settings className="ml-1.5 h-3.5 w-3.5" />
            الصلاحيات
          </Button>
          </>}
          {(admin.isMuted
            ? canRunProfileAdminAction(permissions, "global_unmute")
            : canRunProfileAdminAction(permissions, "global_mute")) && <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (admin.isMuted ? admin.runAction("global_unmute", 0) : admin.runAction("global_mute", 1))}
            className="h-10 rounded-xl border-border bg-card text-xs font-bold text-foreground hover:bg-muted dark:border-red-500/20 dark:bg-slate-900/60 dark:text-red-300 dark:hover:bg-slate-800"
          >
            {admin.isMuted ? <Mic className="ml-1.5 h-3.5 w-3.5" /> : <MicOff className="ml-1.5 h-3.5 w-3.5" />}
            {admin.isMuted ? "الغاء الاسكات" : "اسكات عام"}
          </Button>
          </>}
          {canRunProfileAdminAction(permissions, "kick") && <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (window.confirm("هل تريد طرد هذا العضو؟")) admin.runAction("kick");
            }}
            className="h-10 rounded-xl border-border bg-card text-xs font-bold text-foreground hover:bg-muted dark:border-red-500/20 dark:bg-slate-900/60 dark:text-red-300 dark:hover:bg-slate-800"
          >
            <UserMinus className="ml-1.5 h-3.5 w-3.5" />
            طرد من الموقع
          </Button>
          </>}
        </div>
      </section>

      <ProfileAdminDialogs
        profileId={props.profileId}
        currentRole={props.currentRole || "member"}
        currentDisplayName={props.currentDisplayName}
        currentProfileMsg={props.currentProfileMsg}
        currentLikes={props.currentLikes}
        editDialogOpen={admin.editDialogOpen}
        setEditDialogOpen={admin.setEditDialogOpen}
        powerDialogOpen={admin.powerDialogOpen}
        setPowerDialogOpen={admin.setPowerDialogOpen}
        roomDialogOpen={admin.roomDialogOpen}
        setRoomDialogOpen={admin.setRoomDialogOpen}
        onProfilePatch={props.onProfilePatch}
      />
    </>
  );
}
