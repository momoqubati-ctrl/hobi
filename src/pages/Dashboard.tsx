"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useRealtimeStore } from "@/lib/realtime-store";
import StoriesViewer from "@/components/story/StoriesViewer";
import { initStoriesListeners } from "@/lib/stories-store";
import { disconnectSocket, getSocket } from "@/lib/socket";
import {
  Users, MessageSquare, Home, LayoutGrid, Settings, Bell, Bot, Gift, Mail, FolderOpen,
  Image as LucideImage, X, ShieldCheck, Menu, Search, Activity, Zap, LogOut, MessageCircle, Youtube
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
import AdminCP from "@/components/admin/AdminCP";
import AdminDashboard from "@/components/admin/AdminDashboard";
import GlobalVideoPlayer from "@/components/GlobalVideoPlayer";
import YouTubeSearch from "@/components/chat/YouTubeSearch";

import { ProfileModal } from "@/components/profile/ProfileModal";

const Dashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("members");
  const [activeRoom, setActiveRoom] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminSection, setAdminSection] = useState("overview");
  const [openChatUserId, setOpenChatUserId] = useState<string | null>(null);
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);
  const [pmResetTrigger, setPmResetTrigger] = useState(0);
  const { hasNewWallPosts, setHasNewWallPosts, pmUnreadCount, setPmUnreadCount } = useRealtimeStore();

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
    setOpenChatUserId(userId);
    handleTabChange("pm");
    setSidebarOpen(true);
  };

  const handleLogout = () => {
    disconnectSocket();
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
          if (data.success && data.permissions) {
            setIsAdmin(data.permissions.includes("cp"));
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
      case "members": return <MemberList onOpenChat={handleOpenChat} onOpenProfile={(uid) => setViewProfileId(uid)} />;
      case "activity": return <ActivityFeed />;
      case "rooms": return <RoomList onSelectRoom={(room: any) => { setActiveRoom(room); setSidebarOpen(false); }} />;
      case "youtube": return <YouTubeSearch />;
      case "pm": return <PrivateList key={`pm-${pmResetTrigger}`} openWithUserId={openChatUserId} onChatOpened={() => setOpenChatUserId(null)} onOpenProfile={(uid) => setViewProfileId(uid)} />;
      case "mail": return <InternalMail />;
      case "notifications": return <NotificationsPanel />;
      case "files": return <FileManager />;
      case "gifts": return <GiftStore />;
      case "settings": return <SettingsPanel />;
      case "cpanel": return <AdminCP activeSection={adminSection} onChangeSection={(sec) => { setAdminSection(sec); setSidebarOpen(false); }} />;
      default: return <MemberList onOpenChat={handleOpenChat} onOpenProfile={(uid) => setViewProfileId(uid)} />;
    }
  };

  const renderSidebarContent = () => {
    switch (activeTab) {
      case "members": return <MemberList onOpenChat={handleOpenChat} onOpenProfile={(uid) => setViewProfileId(uid)} />;
      case "activity": return <ActivityFeed />;
      case "rooms": return <RoomList onSelectRoom={(room: any) => { setActiveRoom(room); setSidebarOpen(false); }} />;
      case "wall": return <WallFeed onOpenProfile={(uid) => setViewProfileId(uid)} />;
      case "youtube": return <YouTubeSearch />;
      case "pm": return <PrivateList key={`pm-${pmResetTrigger}`} openWithUserId={openChatUserId} onChatOpened={() => setOpenChatUserId(null)} onOpenProfile={(uid) => setViewProfileId(uid)} />;
      case "mail": return <InternalMail />;
      case "notifications": return <NotificationsPanel />;
      case "files": return <FileManager />;
      case "gifts": return <GiftStore />;
      case "settings": return <SettingsPanel />;
      case "cpanel": return <AdminCP activeSection={adminSection} onChangeSection={(sec) => { setAdminSection(sec); setSidebarOpen(false); }} />;
      default: return <MemberList onOpenChat={handleOpenChat} onOpenProfile={(uid) => setViewProfileId(uid)} />;
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-foreground rtl">
      <PresenceEngine />
      <StoriesViewer />
      <GlobalVideoPlayer activeTab={activeTab} onExpandToWall={handleExpandToWall} />
      
      {/* Mobile Sidebar */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent 
          side="right" 
          className="p-0 w-80 border-l border-slate-200 dark:border-slate-800"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetTitle className="sr-only">القائمة الجانبية</SheetTitle>
          <div className="flex flex-col h-full bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                {activeTabs.find(t => t.id === activeTab)?.label}
              </h2>
              <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">REALTIME</Badge>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
              {/* WallFeed - always mounted, hidden when not active */}
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

              {/* Other tab content */}
              {activeTab !== "wall" && (
                <div className="h-full">{renderOtherTabs()}</div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="z-10 hidden w-80 flex-col border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 lg:flex">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              {activeTabs.find(t => t.id === activeTab)?.label}
            </h2>
            <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">REALTIME</Badge>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {/* WallFeed - always mounted, hidden when not active */}
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

            {/* Other tab content */}
            {activeTab !== "wall" && (
              <div className="h-full">{renderOtherTabs()}</div>
            )}
          </div>

          <div className={`grid ${isAdmin ? 'grid-cols-12' : 'grid-cols-11'} gap-1 border-t border-slate-100 dark:border-slate-800 p-2 bg-slate-50/50 dark:bg-slate-900/50`}>
            {activeTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              const showWallBadge = tab.id === "wall" && hasNewWallPosts && !isActive;
              const showPmBadge = tab.id === "pm" && pmUnreadCount > 0 && !isActive;
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
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {activeTab === "cpanel" ? (
            <AdminDashboard section={adminSection} />
          ) : activeRoom ? (
            <RoomPage room={activeRoom} onBack={() => setActiveRoom(null)} onSelectRoom={setActiveRoom} isEmbedded onOpenProfile={(uid) => setViewProfileId(uid)} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px]">
              <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6 text-right">
                  <h2 className="text-4xl font-black text-slate-800 dark:text-white leading-tight">
                    مرحباً بك في <span className="text-primary">مستقبل</span> التواصل الاجتماعي
                  </h2>
                  <p className="text-lg text-slate-500 font-medium">
                    منصة ذكية تفهم تفاعلاتك، تبني هويتك، وتصلك بالمجتمعات التي تهمك لحظة بلحظة.
                  </p>
                  <div className="flex gap-4 justify-end">
                    <Button onClick={() => handleTabChange('rooms')} size="lg" className="rounded-2xl px-8 font-black shadow-xl shadow-primary/20 h-14 text-lg">
                      استكشف الغرف
                    </Button>
                    <Button variant="outline" size="lg" className="rounded-2xl px-8 font-black h-14 text-lg border-2">
                      هويتي الرقمية
                    </Button>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-[40px] p-6 shadow-2xl border border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-black text-slate-800 dark:text-white flex items-center gap-2">
                      <Activity size={18} className="text-primary" />
                      آخر النشاطات العالمية
                    </h3>
                    <div className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                  </div>
                  <div className="h-[400px] overflow-hidden">
                    <ActivityFeed />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Nav */}
      <nav className="z-30 flex h-20 items-center justify-around border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pb-4 lg:hidden">
        {activeTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          const showWallBadge = tab.id === "wall" && hasNewWallPosts && !isActive;
          const showPmBadge = tab.id === "pm" && pmUnreadCount > 0 && !isActive;
          const isYoutube = tab.id === "youtube";
          return (
            <button
              key={tab.id}
              onClick={() => {
                handleTabChange(tab.id);
                setSidebarOpen(true);
              }}
              className={`relative flex flex-col items-center gap-1 transition-all ${
                isActive
                  ? isYoutube ? "text-red-600 scale-110" : "text-primary scale-110"
                  : isYoutube ? "text-red-400" : "text-slate-400"
              }`}
            >
              <div className={`relative p-3 rounded-2xl ${
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