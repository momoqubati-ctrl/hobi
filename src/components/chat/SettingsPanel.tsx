"use client";

import React, { useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { getSocket, logoutSocket, refreshSocketAuth } from "@/lib/socket";
import { terminateUserSession } from "@/lib/authSession";
import { useRealtimeStore } from "@/lib/realtime-store";
import { useStoriesStore } from "@/lib/stories-store";
import { 
  User, 
  Palette, 
  ShieldCheck, 
  Coins, 
  LogOut, 
  ChevronLeft, 
  Bell, 
  Lock,
  Smartphone,
  Moon,
  Sun,
  Camera,
  Loader2,
  ChevronRight,
  Youtube,
  Sparkles
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showSuccess, showError } from "@/utils/toast";
import FrameSelector from "./FrameSelector";
import MemberCardBgSelector from "./MemberCardBgSelector";
import { SeatFrameSelector } from "./SeatFrameSelector";

type PresenceStatus = "online" | "busy" | "away";

const MANUAL_STATUSES: { id: PresenceStatus; label: string; color: string; dotColor: string; description: string }[] = [
  { id: "online", label: "تلقائي", color: "bg-green-500/10 text-green-600 border-green-500/30", dotColor: "bg-green-500", description: "الحالة التلقائية حسب نشاطك" },
  { id: "busy",   label: "مشغول", color: "bg-orange-500/10 text-orange-600 border-orange-500/30", dotColor: "bg-orange-500", description: "يظهر للجميع أنك مشغول" },
  { id: "away",   label: "غير متواجد", color: "bg-purple-500/10 text-purple-600 border-purple-500/30", dotColor: "bg-purple-500", description: "يظهر للجميع أنك غير متواجد" },
];

const SettingsPanel = () => {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [updateTrigger, setUpdateTrigger] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [showFrameSelector, setShowFrameSelector] = useState(false);
  const [showSeatFrameSelector, setShowSeatFrameSelector] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [newCover, setNewCover] = useState<string | null>(null);
  const [newStatusMsg, setNewStatusMsg] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newNameColor, setNewNameColor] = useState("#000000");
  const [newMessageColor, setNewMessageColor] = useState("#000000");
  const [newStatusFontColor, setNewStatusFontColor] = useState("#000000");
  const [newYoutubeUrl, setNewYoutubeUrl] = useState("");

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Load current manual status from sessionStorage
  const [activeStatus, setActiveStatus] = useState<PresenceStatus>(() => {
    const stored = sessionStorage.getItem("manualStatus");
    if (stored === "busy" || stored === "away") return stored;
    return "online";
  });

  const currentUser = React.useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "null");
      if (!user) return null;
      const resolvedStatusMsg = typeof user.statusMsg === "string" && user.statusMsg.trim()
        ? user.statusMsg.trim()
        : typeof user.profileMsg === "string" && user.profileMsg.trim()
          ? user.profileMsg.trim()
          : "( غير مسجل )";

      return {
        name: typeof user.name === "string" && user.name.trim() ? user.name : "زائر",
        avatar: (typeof user.avatar === "string" && user.avatar.trim()) || (typeof user.avatarUrl === "string" && user.avatarUrl.trim())
          ? (user.avatar || user.avatarUrl)
          : "/pic.png",
        banner:
          typeof user.profileBannerUrl === "string" && user.profileBannerUrl.trim()
            ? user.profileBannerUrl
            : typeof user.profileCover === "string" && user.profileCover.trim()
              ? user.profileCover
              : "/pich.png",
        profileMsg: resolvedStatusMsg,
        statusMsg: resolvedStatusMsg,
        profileThemeId: typeof user.profileThemeId === "string" && user.profileThemeId.trim() ? user.profileThemeId : "افتراضي",
        giftIconUrl: typeof user.giftIconUrl === "string" && user.giftIconUrl.trim() ? user.giftIconUrl : "",
        coins: Number(user.coins) || 0,
        evaluation: Number(user.evaluation) || 0,
        nameColor: typeof user.nameColor === "string" && user.nameColor.trim() ? user.nameColor : "#000000",
        messageColor: typeof user.messageColor === "string" && user.messageColor.trim() ? user.messageColor : "#000000",
        statusFontColor: typeof user.statusFontColor === "string" && user.statusFontColor.trim() ? user.statusFontColor : "#000000",
        youtubeUrl: typeof user.youtubeUrl === "string" ? user.youtubeUrl : "",
      };
    } catch {
      return null;
    }
  }, [updateTrigger]);

  const openEditModal = () => {
    setNewAvatar(null);
    setNewCover(null);
    const isPlaceholder = currentUser?.statusMsg === "(عضو جديد)" || currentUser?.statusMsg === "( غير مسجل )" || currentUser?.profileMsg === "(عضو جديد)" || currentUser?.profileMsg === "( غير مسجل )";
    setNewStatusMsg(isPlaceholder ? "" : currentUser?.statusMsg || currentUser?.profileMsg || "");
    setNewDisplayName(currentUser?.name || "");
    setNewNameColor(currentUser?.nameColor || "#000000");
    setNewMessageColor(currentUser?.messageColor || "#000000");
    setNewStatusFontColor(currentUser?.statusFontColor || "#000000");
    setNewYoutubeUrl(currentUser?.youtubeUrl || "");
    setShowEditProfile(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showError("حجم الصورة يجب أن لا يتجاوز 10 ميجابايت");
      return;
    }

    try {
      const preset = type === 'avatar' ? 'avatar' : 'cover';
      const { compressImage, COMPRESS_PRESETS, getCompressionSummary } = await import("@/lib/image-compress");
      const result = await compressImage(file, COMPRESS_PRESETS[preset]);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (type === 'avatar') {
          setNewAvatar(dataUrl);
        } else {
          setNewCover(dataUrl);
        }
      };
      reader.readAsDataURL(result.file);

      if (result.compressionRatio < 1) {
        showSuccess(getCompressionSummary(result));
      }
    } catch {
      // Fallback: use original file
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (type === 'avatar') {
          setNewAvatar(result);
        } else {
          setNewCover(result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      const token = localStorage.getItem("authToken");
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          avatar: newAvatar,
          cover: newCover,
          profileMsg: newStatusMsg,
          displayName: newDisplayName.trim() || undefined,
          nameColor: newNameColor,
          messageColor: newMessageColor,
          statusFontColor: newStatusFontColor,
          youtubeUrl: newYoutubeUrl,
        })
      });

      const data = await res.json();
      console.log("[SettingsPanel] API response:", data);
      if (data.success) {
        // Use server-normalized avatar URL (guaranteed to be correct format)
        const normalizedAvatar = data.normalizedAvatar || (data.updates?.avatar
          ? (() => {
              const url = data.updates.avatar.trim();
              if (url.startsWith("http://") || url.startsWith("https://"))
                return url.replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/[^/]+\//i, "/minio/");
              return url.startsWith("/") ? url : `/${url}`;
            })()
          : null);
        const normalizedCover = data.updates?.cover
          ? (() => {
              const url = data.updates.cover.trim();
              if (url.startsWith("http://") || url.startsWith("https://"))
                return url.replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/[^/]+\//i, "/minio/");
              return url.startsWith("/") ? url : `/${url}`;
            })()
          : null;

        console.log("[SettingsPanel] Normalized avatar:", normalizedAvatar, "cover:", normalizedCover);
        console.log("[SettingsPanel] nameColor from response:", data.nameColor, "messageColor:", data.messageColor);
        console.log("[SettingsPanel] updates.nameColor:", data.updates?.nameColor);

        // Update local storage user details
        const storedUserRaw = localStorage.getItem("user");
        if (storedUserRaw) {
          const user = JSON.parse(storedUserRaw);
          if (normalizedAvatar) {
            user.avatar = normalizedAvatar;
            user.avatarUrl = normalizedAvatar;
          }
          if (normalizedCover) {
            user.profileCover = normalizedCover;
            user.profileBannerUrl = normalizedCover;
          }
          if (data.updates?.profileMsg !== undefined) {
            user.profileMsg = data.updates.profileMsg;
            user.statusMsg = data.updates.profileMsg;
          }
          if (data.displayName) {
            user.name = data.displayName;
          }
          if (data.nameColor) {
            user.nameColor = data.nameColor;
          }
          if (data.messageColor) {
            user.messageColor = data.messageColor;
          }
          if (data.statusFontColor) {
            user.statusFontColor = data.statusFontColor;
          }
          if (data.updates?.youtubeUrl !== undefined) {
            user.youtubeUrl = data.updates.youtubeUrl;
          }
          localStorage.setItem("user", JSON.stringify(user));
          console.log("[SettingsPanel] Updated localStorage user:", user);
        }
        refreshSocketAuth();

        // Notify server socket to update the in-memory connected user properties
        const socket = getSocket();
        if (socket) {
          socket.emit("profile_update", {
            avatar: normalizedAvatar || undefined,
            displayName: data.displayName || undefined,
            cover: normalizedCover || undefined,
            ...(data.updates?.profileMsg !== undefined ? { profileMsg: data.updates.profileMsg } : {}),
            ...(data.nameColor ? { nameColor: data.nameColor } : {}),
            ...(data.messageColor ? { messageColor: data.messageColor } : {}),
            ...(data.statusFontColor ? { statusFontColor: data.statusFontColor } : {}),
            ...(data.updates?.youtubeUrl !== undefined ? { youtubeUrl: data.updates.youtubeUrl } : {}),
          });
          
          // Also emit user_profile_updated directly to ensure all users see the change immediately
          // Get current user data from localStorage
          const storedUser = localStorage.getItem("user");
          const currentUser = storedUser ? JSON.parse(storedUser) : null;
          
          if (currentUser?.id) {
            console.log("[SettingsPanel] Emitting user_profile_updated with nameColor:", data.nameColor || currentUser.nameColor);
            socket.emit("user_profile_updated", {
              userId: currentUser.id,
              username: data.displayName || currentUser.name,
              avatar: normalizedAvatar || data.updates?.avatar || currentUser.avatar,
              avatarUrl: normalizedAvatar || data.updates?.avatar || currentUser.avatar,
              cover: normalizedCover || data.updates?.cover,
              profileCover: normalizedCover || data.updates?.cover,
              profileMsg: data.updates?.profileMsg,
              statusMsg: data.updates?.profileMsg || "",
              siteBadge: data.updates?.siteBadge || "",
              nameColor: data.nameColor || currentUser.nameColor || "",
              messageColor: data.messageColor || currentUser.messageColor || "",
              statusFontColor: data.statusFontColor || currentUser.statusFontColor || "",
              youtubeUrl: data.updates?.youtubeUrl || currentUser.youtubeUrl || "",
            });
          }
        }

        // Update stories store immediately for own stories (before socket event arrives)
        if (normalizedAvatar) {
          try {
            const rawUser = localStorage.getItem("user");
            const currentUser = rawUser ? JSON.parse(rawUser) : null;
            if (currentUser?.id) {
              useStoriesStore.setState((state) => ({
                stories: state.stories.map((st) =>
                  st.authorId === String(currentUser.id)
                    ? { ...st, authorAvatar: normalizedAvatar }
                    : st
                ),
              }));
            }
          } catch {}
        }

        showSuccess("تم تحديث الملف الشخصي بنجاح");
        setShowEditProfile(false);
        setUpdateTrigger(prev => prev + 1);
      } else {
        showError(data.message || "فشل تحديث الملف الشخصي");
      }
    } catch (err) {
      console.error(err);
      showError("حدث خطأ أثناء الاتصال بالسيرفر");
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = (status: PresenceStatus) => {
    setActiveStatus(status);
    const socket = getSocket();

    if (status === "online") {
      // Clear manual status → revert to automatic idle detection
      sessionStorage.removeItem("manualStatus");
      socket.emit("status_update", { status: "online" });
    } else {
      // Set manual status (busy or away) → persists for the session
      sessionStorage.setItem("manualStatus", status);
      socket.emit("status_update", { status });
    }
  };

  const handleLogout = async () => {
    useRealtimeStore.getState().resetSession();
    await terminateUserSession(true);
    navigate("/", { replace: true });
  };

  if (showEditProfile) {
    return (
      <div className="p-4 pb-24 overflow-y-auto h-full space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setShowEditProfile(false)} className="p-1 rounded-lg hover:bg-muted transition">
            <ChevronRight size={20} />
          </button>
          <h4 className="text-sm font-bold">تعديل الملف الشخصي</h4>
        </div>

        <div className="space-y-6">
          {/* Banner/Cover Upload Preview */}
          <div className="relative h-28 rounded-2xl overflow-hidden bg-muted group border border-border">
            <img 
              src={newCover || currentUser?.banner || "/pich.png"} 
              alt="Banner Preview" 
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            >
              <Camera size={20} />
              <span className="text-xs font-bold">تغيير الغلاف</span>
            </button>
            <input 
              type="file" 
              ref={coverInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={(e) => handleFileChange(e, 'cover')}
            />
          </div>

          {/* Avatar Upload Preview */}
          <div className="flex justify-center -mt-14 relative z-10">
            <div className="relative group w-20 h-20 rounded-full overflow-hidden border-4 border-card bg-muted shadow-md">
              <Avatar className="w-full h-full">
                <AvatarImage src={newAvatar || currentUser?.avatar || "/pic.png"} />
                <AvatarFallback>{currentUser?.name?.[0]}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              >
                <Camera size={16} />
              </button>
              <input 
                type="file" 
                ref={avatarInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={(e) => handleFileChange(e, 'avatar')}
              />
            </div>
          </div>

          {/* Live Preview */}
          <div className="rounded-2xl bg-gradient-to-br from-primary to-blue-600 p-4 text-center">
            <p className="text-lg font-bold" style={{ color: newNameColor === "#000000" ? undefined : newNameColor }}>
              {newDisplayName || currentUser?.name || "الاسم"}
            </p>
            <p className="text-sm mt-1" style={{ color: newMessageColor === "#000000" ? undefined : newMessageColor }}>
              <span style={{ color: newStatusFontColor === "#000000" ? undefined : newStatusFontColor }}>
                {newStatusMsg || currentUser?.statusMsg || "الحالة الشخصية"}
              </span>
            </p>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-xs font-bold text-muted-foreground">الاسم المستعار</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="أدخل اسمك المستعار..."
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              className="rounded-xl border-border bg-muted/50 text-xs font-bold"
              maxLength={40}
            />
          </div>

          {/* Status Message Msg */}
          <div className="space-y-2">
            <Label htmlFor="statusMsg" className="text-xs font-bold text-muted-foreground">الحالة الشخصية / الوصف</Label>
            <Input
              id="statusMsg"
              type="text"
              placeholder="اكتب شيئاً عن نفسك..."
              value={newStatusMsg}
              onChange={(e) => setNewStatusMsg(e.target.value)}
              className="rounded-xl border-border bg-muted/50 text-xs font-bold"
              maxLength={100}
            />
          </div>

          {/* Name Color */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-muted-foreground">لون الاسم</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={newNameColor}
                onChange={(e) => setNewNameColor(e.target.value)}
                className="w-10 h-10 rounded-xl border border-border bg-muted/50 cursor-pointer shrink-0"
              />
              <Input
                type="text"
                value={newNameColor}
                onChange={(e) => setNewNameColor(e.target.value)}
                className="rounded-xl border-border bg-muted/50 text-xs font-bold font-mono"
                maxLength={7}
                placeholder="#000000"
              />
            </div>
          </div>

          {/* Message Color */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-muted-foreground">لون الحالة / الوصف</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={newMessageColor}
                onChange={(e) => setNewMessageColor(e.target.value)}
                className="w-10 h-10 rounded-xl border border-border bg-muted/50 cursor-pointer shrink-0"
              />
              <Input
                type="text"
                value={newMessageColor}
                onChange={(e) => setNewMessageColor(e.target.value)}
                className="rounded-xl border-border bg-muted/50 text-xs font-bold font-mono"
                maxLength={7}
                placeholder="#000000"
              />
            </div>
          </div>

          {/* Status Font Color */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-muted-foreground">لون خط الكتابة</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={newStatusFontColor}
                onChange={(e) => setNewStatusFontColor(e.target.value)}
                className="w-10 h-10 rounded-xl border border-border bg-muted/50 cursor-pointer shrink-0"
              />
              <Input
                type="text"
                value={newStatusFontColor}
                onChange={(e) => setNewStatusFontColor(e.target.value)}
                className="rounded-xl border-border bg-muted/50 text-xs font-bold font-mono"
                maxLength={7}
                placeholder="#000000"
              />
            </div>
          </div>

          {/* YouTube URL */}
          <div className="space-y-2">
            <Label htmlFor="youtubeUrl" className="text-xs font-bold text-muted-foreground">رابط الأغنية المفضلة (يوتيوب)</Label>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-red-500/10 rounded-xl shrink-0">
                <Youtube size={18} className="text-red-500" />
              </div>
              <Input
                id="youtubeUrl"
                type="url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={newYoutubeUrl}
                onChange={(e) => setNewYoutubeUrl(e.target.value)}
                className="rounded-xl border-border bg-muted/50 text-xs font-bold"
                maxLength={255}
              />
            </div>
            <p className="text-[10px] text-muted-foreground font-medium">سيظهر أيقونة يوتيوب في بطاقة عضويتك للمتصفحين</p>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowEditProfile(false)}
            className="rounded-xl font-bold text-xs"
            disabled={isSaving}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleSaveChanges}
            className="rounded-xl bg-primary hover:bg-primary/95 text-white font-bold text-xs shadow-md shadow-primary/20"
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                جاري الحفظ...
              </>
            ) : "حفظ التغييرات"}
          </Button>
        </div>
      </div>
    );
  }

  if (showFrameSelector) {
    return (
      <div className="p-4 pb-24 overflow-y-auto h-full space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setShowFrameSelector(false)} className="p-1 rounded-lg hover:bg-muted transition">
            <ChevronRight size={20} />
          </button>
          <h4 className="text-sm font-bold">الألوان والثيمات</h4>
        </div>
        <FrameSelector onClose={() => setShowFrameSelector(false)} />
        <hr className="border-border/50" />
        <MemberCardBgSelector onClose={() => setShowFrameSelector(false)} />
      </div>
    );
  }

  if (showSeatFrameSelector) {
    return <SeatFrameSelector onClose={() => setShowSeatFrameSelector(false)} />;
  }

  return (
    <div className="p-4 space-y-4 pb-24 overflow-y-auto h-full">
      {/* Profile Summary */}
      <Card className="border-none shadow-sm rounded-3xl overflow-hidden bg-gradient-to-br from-primary to-blue-600 text-white">
        <CardContent
          className="bg-cover bg-center p-6"
          style={currentUser?.banner ? { backgroundImage: `linear-gradient(90deg, rgba(37,99,235,.82), rgba(29,78,216,.82)), url(${currentUser.banner})` } : undefined}
        >
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="w-20 h-20 border-4 border-white/20">
                <AvatarImage src={currentUser?.avatar || "/pic.png"} />
                <AvatarFallback>{currentUser?.name?.[0] || "ز"}</AvatarFallback>
              </Avatar>
              {/* Status dot on avatar */}
              <span className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white/40 ${
                activeStatus === "busy" ? "bg-orange-500" : activeStatus === "away" ? "bg-purple-500" : "bg-green-500"
              } transition-colors duration-300`} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold" style={currentUser?.nameColor && currentUser.nameColor !== "#000000" ? { color: currentUser.nameColor } : undefined}>{currentUser?.name || "زائر"}</h3>
              <p className="text-white/80 text-sm" style={currentUser?.statusFontColor && currentUser.statusFontColor !== "#000000" ? { color: currentUser.statusFontColor } : undefined}>{currentUser?.statusMsg || currentUser?.profileMsg || "(عضو جديد)"} • {currentUser?.evaluation || 0} نقطة</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="bg-card/20 px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1">
                  <Coins size={12} />
                  <span>{currentUser?.coins || 0} كوين</span>
                </div>
                <div className="bg-card/20 px-3 py-1 rounded-full text-[10px] font-bold">
                  {currentUser?.profileThemeId || "افتراضي"}
                </div>
                {currentUser?.giftIconUrl && <img src={currentUser.giftIconUrl} alt="gift" className="h-6 w-6 rounded object-cover" />}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Presence Status Selector ===== */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-muted-foreground px-2 uppercase tracking-wider">حالة الاتصال</h4>
        <div className="grid grid-cols-3 gap-2">
          {MANUAL_STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleStatusChange(s.id)}
              className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all duration-200 ${
                activeStatus === s.id
                  ? `${s.color} border-current shadow-sm scale-[1.02]`
                  : "bg-card dark:bg-card/5 border-transparent hover:bg-muted dark:hover:bg-card/10 text-muted-foreground"
              }`}
            >
              <span className={`w-4 h-4 rounded-full ${s.dotColor} ${
                activeStatus === s.id ? "ring-2 ring-offset-1 ring-offset-background" : ""
              } transition-all duration-200`}
                style={activeStatus === s.id ? { ringColor: s.dotColor } : undefined}
              />
              <span className="text-xs font-bold">{s.label}</span>
              {activeStatus === s.id && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-current rounded-full flex items-center justify-center">
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="text-white">
                    <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground px-2 text-center font-medium" style={{ direction: 'rtl' }}>
          {activeStatus === "online" 
            ? "الحالة تلقائية: أخضر عند النشاط، أصفر بعد دقيقتين من عدم التفاعل"
            : activeStatus === "busy" 
              ? "حالتك: مشغول — ستبقى حتى تغيّرها أو تسجل الخروج"
              : "حالتك: غير متواجد — ستبقى حتى تغيّرها أو تسجل الخروج"
          }
        </p>
      </div>

      {/* Theme Toggle */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-muted-foreground px-2 uppercase tracking-wider">المظهر</h4>
        <button 
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="w-full flex items-center justify-between p-4 bg-card dark:bg-card/5 rounded-2xl shadow-sm hover:bg-muted dark:hover:bg-card/10 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted dark:bg-card/5 rounded-xl group-hover:bg-card dark:group-hover:bg-card/10 transition-colors">
              {theme === "dark" ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-blue-500" />}
            </div>
            <span className="font-bold text-sm text-foreground dark:text-slate-200">
              {theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground">{theme === "dark" ? "Light" : "Dark"}</span>
            <ChevronLeft size={18} className="text-slate-300" />
          </div>
        </button>
      </div>

      {/* Settings Groups */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-muted-foreground px-2 uppercase tracking-wider">الحساب والخصوصية</h4>
        <SettingsItem icon={<User size={20} className="text-blue-500" />} label="تعديل الملف الشخصي" onClick={openEditModal} />
        <SettingsItem icon={<Palette size={20} className="text-purple-500" />} label="الألوان والثيمات" onClick={() => setShowFrameSelector(true)} />
        <SettingsItem icon={<Sparkles size={20} className="text-amber-500" />} label="إطارات المقاعد الصوتية 🎙️" onClick={() => setShowSeatFrameSelector(true)} />
        <SettingsItem icon={<ShieldCheck size={20} className="text-green-500" />} label="إعدادات الخصوصية" />
        <SettingsItem icon={<Bell size={20} className="text-amber-500" />} label="التنبيهات والإشعارات" />
      </div>

      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-bold text-muted-foreground px-2 uppercase tracking-wider">الخدمات والعملات</h4>
        <SettingsItem icon={<Coins size={20} className="text-yellow-500" />} label="متجر الكوين والهدايا" />
        <SettingsItem icon={<Smartphone size={20} className="text-indigo-500" />} label="طلب شحن رصيد" />
      </div>

      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-bold text-muted-foreground px-2 uppercase tracking-wider">أخرى</h4>
        <SettingsItem icon={<Lock size={20} className="text-muted-foreground" />} label="تغيير كلمة المرور" />
        <SettingsItem icon={<LogOut size={20} className="text-red-500" />} label="تسجيل الخروج" danger onClick={handleLogout} />
      </div>

      <div className="text-center pt-4">
        <p className="text-[10px] text-muted-foreground font-medium">إصدار التطبيق 1.0.0</p>
      </div>
    </div>
  );
};

const SettingsItem = ({ icon, label, danger, onClick }: any) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center justify-between p-4 bg-card dark:bg-card/5 rounded-2xl shadow-sm hover:bg-muted dark:hover:bg-card/10 transition-colors group"
  >
    <div className="flex items-center gap-3">
      <div className="p-2 bg-muted dark:bg-card/5 rounded-xl group-hover:bg-card dark:group-hover:bg-card/10 transition-colors">
        {icon}
      </div>
      <span className={`font-bold text-sm ${danger ? 'text-red-500' : 'text-foreground dark:text-slate-200'}`}>{label}</span>
    </div>
    <ChevronLeft size={18} className="text-slate-300" />
  </button>
);

export default SettingsPanel;
