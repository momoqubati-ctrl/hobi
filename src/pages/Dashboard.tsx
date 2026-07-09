"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useRealtimeStore } from "@/lib/realtime-store";
import StoriesViewer from "@/components/story/StoriesViewer";
import { initStoriesListeners } from "@/lib/stories-store";
import { logoutSocket, getSocket } from "@/lib/socket";
import {
  Users, MessageSquare, Home, LayoutGrid, Settings, Bell, Bot, Gift, Mail, FolderOpen,
  Image as LucideImage, X, ShieldCheck, Menu, Search, Activity, Zap, LogOut, MessageCircle, Youtube, Lock, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MemberList from "@/components/chat/MemberList";
import RoomList from "@/components/chat/RoomList";
import WallFeed from "@/components/chat/WallFeed";
import PrivateList from "@/components/chat/PrivateList";
import SettingsPanel from "@/components/chat/SettingsPanel";
import GiftStore from "@/components/chat/GiftStore";
import InternalMail from "@/components/chat/InternalMail";
import FileManager from "@/components/chat/FileManager";
import NotificationsPanel, { NotificationsBell } from "@/components/chat/NotificationsPanel";
import PresenceEngine from "@/components/realtime/PresenceEngine";
import ActivityFeed from "@/components/realtime/ActivityFeed";
import RoomPage from "@/components/chat/RoomPage";
import DashboardRooms from "@/components/chat/DashboardRooms";
import DashboardMembers from "@/components/chat/DashboardMembers";
import AdminCP from "@/components/admin/AdminCP";
import AdminDashboard from "@/components/admin/AdminDashboard";
import GlobalVideoPlayer from "@/components/GlobalVideoPlayer";
import YouTubeSearch from "@/components/chat/YouTubeSearch";

import { ProfileModal } from "@/components/profile/ProfileModal";

const hasControlPanelAccess = (data: any) => {
  const permissions = Array.isArray(data?.permissions) ? data.permissions : [];
  const hasCpPermission = permissions.some((permission: unknown) => {
    if (typeof permission !== "string") return false;
    return permission === "cp" || permission === "cp.all" || permission.startsWith("cp.");
  });
  const role = String(data?.role || "").toLowerCase();
  return hasCpPermission || role === "owner" || role === "admin";
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("members");
  const [activeRoom, setActiveRoom] = useState<any>(null);
  const [activeRoomPassword, setActiveRoomPassword] = useState<string>("");
  const [pendingRoom, setPendingRoom] = useState<any>(null);
  const [pendingRoomLoading, setPendingRoomLoading] = useState(false);
  const [pendingRoomError, setPendingRoomError] = useState("");
  const [lockedRoom, setLockedRoom] = useState<any>(null);
  const [lockedRoomPassword, setLockedRoomPassword] = useState("");
  const [lockedRoomError, setLockedRoomError] = useState("");
  const [lockedRoomAttempts, setLockedRoomAttempts] = useState(0);
  const [lockedRoomLoading, setLockedRoomLoading] = useState(false);
  const lockedAttemptsRef = useRef(0);
  const MAX_ATTEMPTS = 3;
  const [fullRoomAlert, setFullRoomAlert] = useState<any>(null);

  const performJoinRoom = useCallback((room: any, password: string) => {
    if (pendingRoomLoading) return;
    const socket = getSocket();
    if (!socket?.connected) return;
    setPendingRoom(room);
    setPendingRoomLoading(true);
    setPendingRoomError("");
    console.log("[CLIENT_JOIN] emitting join_room", { roomId: room.id, password });
    socket.emit("join_room", { roomId: room.id, password }, (res: any) => {
      console.log("[CLIENT_JOIN] callback", { roomId: room.id, res });
      setPendingRoomLoading(false);
      setPendingRoom(null);
      if (res?.success) {
        setLockedRoom(null);
        lockedAttemptsRef.current = 0;
        setLockedRoomAttempts(0);
        setActiveRoom(room);
        setActiveRoomPassword(password);
        setSidebarOpen(false);
        setPendingRoomError("");
      } else if (res?.needPassword) {
        setLockedRoom(room);
        setLockedRoomPassword("");
        const next = lockedAttemptsRef.current + 1;
        lockedAttemptsRef.current = next;
        setLockedRoomAttempts(next);
        if (next >= MAX_ATTEMPTS) {
          setLockedRoomError("تم تجاوز الحد الأقصى للمحاولات");
          setTimeout(() => { setLockedRoom(null); lockedAttemptsRef.current = 0; setLockedRoomAttempts(0); }, 1500);
        } else {
          setLockedRoomError(`كلمة المرور غير صحيحة - متبقي ${MAX_ATTEMPTS - next} محاولات`);
          setLockedRoomPassword("");
        }
      } else if (res?.full) {
        setLockedRoomError(res?.message || "الغرفة ممتلئة حالياً");
        setTimeout(() => { setLockedRoom(null); lockedAttemptsRef.current = 0; setLockedRoomAttempts(0); }, 2000);
      } else if (res?.likesRequired) {
        setLockedRoomError(res?.message || "ليس لديك عدد الإعجابات الكافي");
        setTimeout(() => { setLockedRoom(null); }, 2500);
      } else {
        const message = res?.message || "حدث خطأ";
        setPendingRoomError(message);
        window.dispatchEvent(new CustomEvent("show-client-alert", {
          detail: {
            alertId: String(Date.now()),
            fromUsername: "النظام",
            fromAvatar: "/pic.png",
            message,
            timestamp: Date.now(),
          }
        }));
      }
    });
  }, [pendingRoomLoading]);

  const tryJoinLocked = useCallback((room: any, password: string) => {
    performJoinRoom(room, password);
  }, [performJoinRoom]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminSection, setAdminSection] = useState("overview");
  const [openChatUserId, setOpenChatUserId] = useState<string | null>(null);
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);
  const [pmResetTrigger, setPmResetTrigger] = useState(0);
  const isOpeningChatRef = useRef(false);
  const { hasNewWallPosts, setHasNewWallPosts, pmUnreadCount, setPmUnreadCount, mailUnreadCount, resetSession } = useRealtimeStore();

  const handleTabChange = (tabId: string) => {
    if (tabId === "pm" && activeTab === "pm") {
      setPmResetTrigger(prev => prev + 1);
    }
    setActiveTab(tabId);
    if (tabId === "wall") {
      setHasNewWallPosts(false);
    }
  };

  const handleOpenChat = (userId: string) => {
    isOpeningChatRef.current = true;
    setOpenChatUserId(userId);
    handleTabChange("pm");
    setSidebarOpen(true);
    requestAnimationFrame(() => { isOpeningChatRef.current = false; });
  };

  const handleLogout = () => {
    resetSession();
    logoutSocket();
    sessionStorage.removeItem("manualStatus");
    localStorage.removeItem("authToken");
    localStorage.removeItem("user");
    navigate("/", { replace: true });
  };

  // User Permissions
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    return initStoriesListeners();
  }, []);

  // ─── جلب عدد الرسائل غير المقروءة + الاستماع اللحظي ──────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const currentUser = (() => {
      try { return JSON.parse(localStorage.getItem("user") || "null"); }
      catch { return null; }
    })();
    if (!currentUser?.id) return;

    // جلب العدد الأولي عند تحميل الصفحة
    socket.emit("pm:conversations", (res: any) => {
      if (res?.success && Array.isArray(res.conversations)) {
        const total = res.conversations.reduce((s: number, c: any) => s + (c.unreadCount || 0), 0);
        setPmUnreadCount(total);
      }
    });

    // الاستماع لأي رسالة جديدة وصولاً للمستخدم不管你 على أي تبويب
    const onNewMessage = (msg: any) => {
      if (msg?.receiverId === currentUser.id) {
        setPmUnreadCount(prev => (typeof prev === "number" ? prev : 0) + 1);
      }
    };
    socket.on("pm:message", onNewMessage);

    return () => {
      socket.off("pm:message", onNewMessage);
    };
  }, [setPmUnreadCount]);

  // ─── استماع لتحديثات الغرفة اللحظية ──────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onRoomUpdated = (data: { roomId: string; room: any }) => {
      setActiveRoom((prev: any) => {
        if (prev && String(prev.id) === String(data.roomId)) {
          return { ...prev, ...data.room };
        }
        return prev;
      });
    };

    const onRoomKicked = (payload: { roomId: string; duration: number; message: string }) => {
      // السيرفر لا يُرسل هذا الحدث إلا للسوكيت المطرود بالفعل
      // لذا نُطبِّق الطرد مباشرة بدون شرط إضافي
      setActiveRoomPassword("");
      window.dispatchEvent(new CustomEvent("show-client-alert", {
        detail: {
          alertId: String(Date.now()),
          fromUsername: "النظام",
          fromAvatar: "/pic.png",
          message: payload.message,
          timestamp: Date.now()
        }
      }));
      setActiveRoom(null);
    };

    socket.on("room_updated", onRoomUpdated);
    socket.on("room_kicked", onRoomKicked);
    return () => {
      socket.off("room_updated", onRoomUpdated);
      socket.off("room_kicked", onRoomKicked);
    };
  }, []);

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        const token = localStorage.getItem("authToken");
        if (!token) return;
        const res = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setIsAdmin(hasControlPanelAccess(data));
          }
        }
      } catch (err) {
        console.error("Error fetching permissions:", err);
      }
    };
    fetchPermissions();
  }, []);

  const TABS = [
    { id: "members", icon: Users, label: "المتواجدون" },
    { id: "activity", icon: Activity, label: "النشاطات" },
    { id: "rooms", icon: Home, label: "الغرف" },
    { id: "wall", icon: LayoutGrid, label: "الحائط" },
    { id: "youtube", icon: Youtube, label: "يوتيوب" },
    { id: "pm", icon: MessageCircle, label: "الدردشة الخاصة" },
    { id: "mail", icon: Mail, label: "البريد" },
    { id: "notifications", icon: Bell, label: "التنبيهات" },
    { id: "files", icon: FolderOpen, label: "الملفات" },
    { id: "gifts", icon: Gift, label: "الهدايا" },
    { id: "settings", icon: Settings, label: "الإعدادات" },
  ];

  const activeTabs = [
    ...TABS,
    ...(isAdmin ? [{ id: "cpanel", icon: ShieldCheck, label: "لوحة التحكم" }] : []),
  ];

  const handleExpandToWall = useCallback(() => {
    handleTabChange("wall");
  }, []);

  const renderOtherTabs = () => {
    switch (activeTab) {
      case "activity": return <ActivityFeed />;
      case "youtube": return <YouTubeSearch />;
      case "mail": return <InternalMail />;
      case "files": return <FileManager />;
      case "gifts": return <GiftStore />;
      case "settings": return <SettingsPanel />;
      case "cpanel": return <AdminCP activeSection={adminSection} onChangeSection={(sec) => { setAdminSection(sec); setSidebarOpen(false); }} />;
      default: return null;
    }
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-foreground rtl">
      <PresenceEngine />
      <StoriesViewer />
      <GlobalVideoPlayer activeTab={activeTab} onExpandToWall={handleExpandToWall} />
      
      {/* Backdrop for mobile */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 lg:hidden transition-opacity duration-300 ${
          sidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => {
          if (!isOpeningChatRef.current) setSidebarOpen(false);
        }}
      />

      {/* Unified Sidebar - Spans full height on the right on desktop */}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 flex w-80 flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl lg:shadow-none transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:flex ${
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3 shrink-0">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
            {activeTabs.find(t => t.id === activeTab)?.label}
          </h2>
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">REALTIME</Badge>
            <button
              onClick={() => setSidebarOpen(false)}
              className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors lg:hidden"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {/* members (Online Users) - always mounted, hidden when not active */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{
              visibility: activeTab === "members" ? "visible" : "hidden",
              zIndex: activeTab === "members" ? 1 : -1,
              pointerEvents: activeTab === "members" ? "auto" : "none",
            }}
          >
            <MemberList onOpenChat={handleOpenChat} onOpenProfile={(uid) => setViewProfileId(uid)} />
          </div>

          {/* rooms - always mounted, hidden when not active */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{
              visibility: activeTab === "rooms" ? "visible" : "hidden",
              zIndex: activeTab === "rooms" ? 1 : -1,
              pointerEvents: activeTab === "rooms" ? "auto" : "none",
            }}
          >
            <RoomList onSelectRoom={(room: any, password?: string) => {
              if (room.members >= (room.maxMembers || 50)) {
                setFullRoomAlert(room);
                return;
              }
              performJoinRoom(room, password || "");
            }} onLockedRoom={(room: any) => { setLockedRoom(room); setLockedRoomPassword(""); setLockedRoomError(""); lockedAttemptsRef.current = 0; setLockedRoomAttempts(0); }} activeRoomId={activeRoom?.id} />
          </div>

          {/* wall (WallFeed) - always mounted, hidden when not active */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{
              visibility: activeTab === "wall" ? "visible" : "hidden",
              zIndex: activeTab === "wall" ? 1 : -1,
              pointerEvents: activeTab === "wall" ? "auto" : "none",
            }}
          >
            <WallFeed onOpenProfile={(uid) => setViewProfileId(uid)} />
          </div>

          {/* pm (Private Chats) - always mounted, hidden when not active */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{
              visibility: activeTab === "pm" ? "visible" : "hidden",
              zIndex: activeTab === "pm" ? 1 : -1,
              pointerEvents: activeTab === "pm" ? "auto" : "none",
            }}
          >
            <PrivateList 
              key={`pm-${pmResetTrigger}`} 
              openWithUserId={openChatUserId} 
              onChatOpened={() => setOpenChatUserId(null)} 
              onOpenProfile={(uid) => setViewProfileId(uid)} 
            />
          </div>

          {/* notifications - always mounted, hidden when not active */}
          <div
            className="absolute inset-0 flex flex-col"
            style={{
              visibility: activeTab === "notifications" ? "visible" : "hidden",
              zIndex: activeTab === "notifications" ? 1 : -1,
              pointerEvents: activeTab === "notifications" ? "auto" : "none",
            }}
          >
            <NotificationsPanel />
          </div>

          {/* Other tabs - mounted dynamically if active */}
          {!["members", "rooms", "wall", "pm", "notifications"].includes(activeTab) && (
            <div className="h-full">{renderOtherTabs()}</div>
          )}
        </div>
      </aside>

      {/* Password Dialog for Locked Rooms - rendered at root level */}
      {lockedRoom && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 w-80 rounded-2xl bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center gap-2">
              <Lock size={18} className="text-orange-500" />
              <h3 className="text-sm font-black">غرفة محمية بكلمة مرور</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              أدخل كلمة مرور الغرفة "{lockedRoom.name}" للدخول
            </p>
            {lockedRoomError && (
              <div className={`mb-3 rounded-lg p-2 text-center text-xs font-bold ${lockedRoomError.includes("صحيحة") ? "bg-red-50 text-red-600" : lockedRoomError.includes("تجاوز") ? "bg-orange-50 text-orange-600" : "bg-red-50 text-red-600"}`}>{lockedRoomError}</div>
            )}
            <input
              type="password"
              name="room-password"
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              value={lockedRoomPassword}
              onChange={(e) => setLockedRoomPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && lockedRoomPassword.trim() && !lockedRoomLoading) {
                  tryJoinLocked(lockedRoom, lockedRoomPassword.trim());
                }
              }}
              placeholder="كلمة المرور"
              className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
              disabled={lockedRoomLoading}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setLockedRoom(null); lockedAttemptsRef.current = 0; setLockedRoomAttempts(0); setLockedRoomError(""); }}
                className="flex-1 rounded-xl text-xs font-bold"
              >
                إلغاء
              </Button>
              <Button
                onClick={() => {
                  if (!lockedRoomPassword.trim() || lockedRoomLoading) return;
                  tryJoinLocked(lockedRoom, lockedRoomPassword.trim());
                }}
                disabled={!lockedRoomPassword.trim() || lockedRoomLoading}
                className="flex-1 rounded-xl bg-green-600 text-xs font-bold text-white hover:bg-green-700"
              >
                {lockedRoomLoading ? <Loader2 className="animate-spin" size={14} /> : "دخول"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Full Room Alert Modal */}
      {fullRoomAlert && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-80 overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-center bg-gradient-to-br from-red-500 to-orange-500 px-6 py-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
            </div>
            <div className="px-6 pt-5 pb-6 text-center">
              <h3 className="mb-2 text-base font-black text-slate-800 dark:text-white">الغرفة ممتلئة</h3>
              <p className="mb-1 text-sm font-bold text-slate-500 dark:text-slate-400">
                "{fullRoomAlert.name}"
              </p>
              <p className="mb-5 text-xs text-slate-400 dark:text-slate-500">
                العدد الأقصى للأعضاء ({fullRoomAlert.maxMembers || 50}) تم الوصول إليه. حاول مرة أخرى لاحقاً.
              </p>
              <Button
                onClick={() => setFullRoomAlert(null)}
                className="w-full rounded-xl bg-gradient-to-r from-red-500 to-orange-500 py-2.5 text-sm font-black text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40 transition-all"
              >
                حسناً
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Left Container - containing header, main content, and laptop button footer */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        {!activeRoom && (
          <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="rounded-xl lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} />
              </Button>
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
                  <Zap className="text-white" size={20} fill="currentColor" />
                </div>
                <div className="hidden sm:block">
                  <h1 className="text-base font-black tracking-tight">DIAD ENGINE</h1>
                  <p className="text-[9px] font-bold text-primary uppercase tracking-widest">Realtime Identity Platform</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-green-500/20 bg-green-500/5 px-3 py-1.5 text-green-600">
                <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[8px] font-black uppercase tracking-wider">Live</span>
              </div>
              <NotificationsBell onOpen={() => handleTabChange("notifications")} />
              <Button variant="ghost" size="icon" className="rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20" onClick={handleLogout} title="تسجيل الخروج">
                <LogOut size={20} />
              </Button>
            </div>
          </header>
        )}

        {/* Main Content Area */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {activeTab === "cpanel" ? (
            <AdminDashboard section={adminSection} />
          ) : activeRoom ? (
            <RoomPage 
              room={activeRoom} 
              roomPassword={activeRoomPassword}
              onBack={() => setActiveRoom(null)} 
              onSelectRoom={performJoinRoom} 
              isEmbedded 
              autoJoin={false}
              onOpenProfile={(uid) => setViewProfileId(uid)} 
              onOpenSidebar={() => setSidebarOpen(true)}
              onOpenNotifications={() => handleTabChange("notifications")}
              onLogout={handleLogout}
            />
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px]">
              <div className="flex-1 overflow-y-auto">
                <DashboardRooms
                  onSelectRoom={(room: any, password?: string) => {
                    if (room.members >= (room.maxMembers || 50)) {
                      setFullRoomAlert(room);
                      return;
                    }
                    if (password != null && password !== "") {
                      performJoinRoom(room, password);
                      return;
                    }
                    performJoinRoom(room, "");
                  }}
                  onLockedRoom={(room: any) => {
                    if (pendingRoomLoading) return;
                    setLockedRoom(room);
                    setLockedRoomPassword("");
                    setLockedRoomError("");
                    lockedAttemptsRef.current = 0;
                    setLockedRoomAttempts(0);
                  }}
                  activeRoomId={activeRoom?.id}
                />
                {pendingRoomLoading && pendingRoom && (
                  <div className="mx-4 mb-3 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-xs font-bold text-primary shadow-sm">
                    جاري الانضمام إلى الغرفة "{pendingRoom.name}"…
                  </div>
                )}
                {pendingRoomError && (
                  <div className="mx-4 mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700 shadow-sm">
                    {pendingRoomError}
                  </div>
                )}
                <DashboardMembers
                  onOpenChat={(userId: string) => {
                    handleOpenChat(userId);
                  }}
                  onOpenProfile={(userId: string) => {
                    setViewProfileId(userId);
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Desktop small button grid - Hidden on mobile, moved here from sidebar */}
        <div className={`hidden lg:grid ${isAdmin ? 'grid-cols-12' : 'grid-cols-11'} gap-1 border-t border-slate-100 dark:border-slate-800 p-2 bg-slate-50/50 dark:bg-slate-900/50`}>
          {activeTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            const showWallBadge = tab.id === "wall" && hasNewWallPosts && !isActive;
            const showPmBadge = tab.id === "pm" && pmUnreadCount > 0 && !isActive;
            const showMailBadge = tab.id === "mail" && mailUnreadCount > 0 && !isActive;
            const isYoutube = tab.id === "youtube";
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`relative flex flex-col items-center justify-center rounded-xl p-2.5 transition-all ${
                  isActive
                    ? isYoutube
                      ? "bg-red-600 text-white shadow-lg shadow-red-500/30 scale-105"
                      : "bg-primary text-white shadow-lg shadow-primary/20 scale-105"
                    : isYoutube
                    ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    : "text-slate-400 hover:bg-white dark:hover:bg-slate-800"
                }`}
              >
                <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                {showWallBadge && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                )}
                {showPmBadge && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-black px-1 animate-bounce">
                    {pmUnreadCount > 99 ? "99+" : pmUnreadCount}
                  </span>
                )}
                {showMailBadge && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-black px-1 animate-bounce">
                    {mailUnreadCount > 99 ? "99+" : mailUnreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Mobile Nav */}
        <nav className="z-30 flex h-16 items-center gap-1 overflow-x-auto scrollbar-none border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pb-2 lg:hidden flex-nowrap [direction:rtl]">
          {activeTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            const showWallBadge = tab.id === "wall" && hasNewWallPosts && !isActive;
            const showPmBadge = tab.id === "pm" && pmUnreadCount > 0 && !isActive;
            const showMailBadge = tab.id === "mail" && mailUnreadCount > 0 && !isActive;
            const isYoutube = tab.id === "youtube";
            return (
              <button
                key={tab.id}
                onClick={() => {
                  handleTabChange(tab.id);
                  setSidebarOpen(true);
                }}
                className={`relative flex flex-col items-center gap-1 transition-all flex-shrink-0 w-16 ${
                  isActive
                    ? isYoutube ? "text-red-600 scale-110" : "text-primary scale-110"
                    : isYoutube ? "text-red-400" : "text-slate-400"
                }`}
              >
                <div className={`relative p-2 rounded-2xl ${
                  isActive
                    ? isYoutube ? "bg-red-100 dark:bg-red-950/30" : "bg-primary/10"
                    : ""
                }`}>
                  <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                  {showWallBadge && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  )}
                  {showPmBadge && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-black px-1">
                      {pmUnreadCount > 99 ? "99+" : pmUnreadCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      <ProfileModal
        profileId={viewProfileId}
        onClose={() => setViewProfileId(null)}
        isAdmin={isAdmin}
        onMessage={(userId) => {
          setViewProfileId(null);
          handleOpenChat(userId);
        }}
      />
    </div>
  );
};

export default Dashboard;
