"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, X, Wifi, WifiOff } from 'lucide-react';
import { ProfileModal } from '../profile/ProfileModal';
import { Input } from "@/components/ui/input";
import StoriesBar from './StoriesBar';
import StoryCreator from '@/components/story/StoryCreator';
import { getCountryFlagSrc, normalizeCountryCode } from "@/lib/countries";
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";

interface MemberListProps {
  isSearchOpen?: boolean;
  setIsSearchOpen?: (open: boolean) => void;
  onOpenChat?: (userId: string) => void;
  onOpenProfile?: (userId: string) => void;
}

type OnlineMember = {
  id: string;
  socketId?: string;
  username: string;
  role: string;
  avatar: string;
  countryCode: string;
  avatarFrameUrl?: string;
  giftIconUrl?: string;
  memberCardBgUrl?: string;
  nameColor?: string;
  messageColor?: string;
  roomId?: string;
  status?: string;
  idreg?: string;
  siteBadge?: string;
  avatarUrl?: string;
  profileCover?: string;
  statusMsg?: string;
};

const getPresenceKey = (member: { id?: string; socketId?: string; username?: string; name?: string; role?: string }) => {
  const id = String(member.id || "").trim();
  if (id && id !== "0") return `id:${id}`;
  if (member.socketId) return `socket:${member.socketId}`;
  const name = String(member.username || member.name || "").trim().toLowerCase();
  if (name && member.role !== "guest") return `username:${name}`;
  return `guest:${name || "anonymous"}`;
};

// ===== Status Utilities =====
type PresenceStatus = "online" | "idle" | "busy" | "away";

const STATUS_CONFIG: Record<PresenceStatus, { color: string; pulseColor: string; label: string }> = {
  online: { color: "bg-green-500", pulseColor: "bg-green-400", label: "متصل" },
  idle:   { color: "bg-amber-400", pulseColor: "bg-amber-300", label: "بعيد مؤقتاً" },
  busy:   { color: "bg-orange-500", pulseColor: "bg-orange-400", label: "مشغول" },
  away:   { color: "bg-purple-500", pulseColor: "bg-purple-400", label: "غير متواجد" },
};

const getStatusConfig = (status?: string) => {
  if (status && status in STATUS_CONFIG) return STATUS_CONFIG[status as PresenceStatus];
  return STATUS_CONFIG.online;
};

const getMemberIdentity = (member: { id?: string; username?: string; name?: string; role?: string }) => {
  const id = String(member.id || "").trim();
  if (id && id !== "0") return `id:${id}`;

  const name = String(member.username || member.name || "").trim().toLowerCase();
  if (name && member.role !== "guest") return `username:${name}`;

  return `guest:${name}`;
};

const isHexColor = (v: string) => /^#?[0-9a-fA-F]{3,8}$/.test(v.replace(/^\//, ""));

const getCurrentMember = () => {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const user = JSON.parse(raw);
    const name = typeof user.name === "string" && user.name.trim() ? user.name : "زائر";
    const role = user.role === "admin" ? "admin" : user.role === "guest" ? "guest" : "member";
    const rawProfileMsg = typeof user.profileMsg === "string" ? user.profileMsg.trim() : "";
    const rawStatusMsg = typeof user.statusMsg === "string" ? user.statusMsg.trim() : "";
    const resolvedStatusMsg = rawStatusMsg || rawProfileMsg || (role === "guest" ? "( غير مسجل )" : "(عضو جديد)");

    return {
      id: user.id || "0",
      idreg: (() => {
        const raw = user.idreg;
        if (typeof raw === "string" && raw.trim()) {
          // إذا كانت تحتوي رقماً فقط، نضيف #
          return raw.startsWith("#") ? raw : `#${raw}`;
        }
        if (typeof raw === "number") return `#${raw}`;
        return role === "guest" ? "#300" : "#101";
      })(),
      name,
      role,
      rank: role === "admin" ? 100 : 0,
      color: role === "admin" ? "text-red-600" : "text-foreground",
      bg: "bg-blue-50",
      status: "online" as string,
      room: "الغرفة العامة",
      country: normalizeCountryCode(user.countryCode),
      points: Number(user.evaluation) || 0,
      rep: Number(user.rep) || 0,
      coins: Number(user.coins) || 0,
      giftsReceivedCount: Number(user.giftsReceivedCount) || 0,
      avatar: (typeof user.avatar === "string" && user.avatar.trim()) || (typeof user.avatarUrl === "string" && user.avatarUrl.trim()) ? (user.avatar || user.avatarUrl) : "/pic.png",
      profileCover:
        typeof user.profileBannerUrl === "string" && user.profileBannerUrl.trim()
          ? user.profileBannerUrl
          : typeof user.profileCover === "string" && user.profileCover.trim()
            ? user.profileCover
            : "/pich.png",
      profileThemeId: typeof user.profileThemeId === "string" ? user.profileThemeId : "",
      avatarFrameUrl: typeof user.avatarFrameUrl === "string" ? user.avatarFrameUrl : "",
      memberCardBgUrl: typeof user.memberCardBgUrl === "string" ? user.memberCardBgUrl : "",
      giftIconUrl:
        typeof user.giftIconUrl === "string" && user.giftIconUrl.trim()
          ? user.giftIconUrl
          : typeof user.giftIcon === "string"
            ? user.giftIcon
            : "",
      profileIconUrl: typeof user.profileIconUrl === "string" ? user.profileIconUrl : "",
      nameGradient: typeof user.nameGradient === "string" ? user.nameGradient : "",
      nameEffectId: typeof user.nameEffectId === "string" ? user.nameEffectId : "",
      messageBubbleStyle: typeof user.messageBubbleStyle === "string" ? user.messageBubbleStyle : "default",
      profileAccentColor: typeof user.profileAccentColor === "string" ? user.profileAccentColor : "#2563EB",
      power: typeof user.power === "string" ? user.power : "",
      siteBadge: typeof user.siteBadge === "string" && user.siteBadge.trim() ? user.siteBadge : "",
      nameColor: typeof user.nameColor === "string" ? user.nameColor : "",
      messageColor: typeof user.messageColor === "string" ? user.messageColor : "",
      statusMsg: resolvedStatusMsg,
      isLogin: typeof user.isLogin === "string" ? user.isLogin : role === "guest" ? "زائر" : "عضو",
    };
  } catch {
    return null;
  }
};

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const MemberList = ({ isSearchOpen = false, setIsSearchOpen, onOpenChat, onOpenProfile }: MemberListProps) => {
  const {
    onlineUsers,
    onlineCount,
    mergeOnlineUser,
    removeOnlineUser
  } = useRealtimeStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isConnected, setIsConnected] = useState(true); // Default to true since presence engine connects it
  const [storyCreatorOpen, setStoryCreatorOpen] = useState(false);

  const [myStatus, setMyStatus] = useState<PresenceStatus>("online");
  const myStatusRef = useRef<PresenceStatus>("online");
  const [userStatuses, setUserStatuses] = useState<Map<string, string>>(new Map());
  const [userCountries, setUserCountries] = useState<Map<string, string>>(new Map());

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualStatusRef = useRef<string | null>(null);

  const [profileTrigger, setProfileTrigger] = useState(0);
  const currentMember = useMemo(() => getCurrentMember(), [profileTrigger]);

  useEffect(() => {
    const handler = () => setProfileTrigger((p) => p + 1);
    window.addEventListener("frame-updated", handler);
    return () => window.removeEventListener("frame-updated", handler);
  }, []);

  // Sync isConnected status with actual socket state
  useEffect(() => {
    const socket = getSocket();
    setIsConnected(socket.connected);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // Sync userStatuses and userCountries from onlineUsers list
  useEffect(() => {
    const newStatuses = new Map<string, string>();
    const newCountries = new Map<string, string>();
    for (const u of onlineUsers) {
      const key = getPresenceKey(u);
      if (!key) continue;
      newStatuses.set(key, u.status || "online");
      newCountries.set(key, u.countryCode || "SA");
    }
    setUserStatuses(newStatuses);
    setUserCountries(newCountries);
  }, [onlineUsers]);

  // Keep user profile updated locally if updated
  useEffect(() => {
    const socket = getSocket();
    const onUserProfileUpdated = (data: any) => {
      console.log("[MemberList] user_profile_updated received:", data);
      if (!data?.userId) return;

      console.log("Checking if this is current member:", data.userId === currentMember?.id, "or", data.username, "==", currentMember?.name);
      if (data.userId === currentMember?.id || data.username === currentMember?.name) {
        console.log("Updating profile trigger for current member");
        setProfileTrigger((prev) => prev + 1);
      }
    };

    socket.on("user_profile_updated", onUserProfileUpdated);
    return () => {
      socket.off("user_profile_updated", onUserProfileUpdated);
    };
  }, [currentMember]);

  // ===== Idle Detection for Current User =====
  useEffect(() => {
    // Load manual status from sessionStorage
    const storedManual = sessionStorage.getItem("manualStatus");
    if (storedManual === "busy" || storedManual === "away") {
      manualStatusRef.current = storedManual;
      setMyStatus(storedManual as PresenceStatus);
      myStatusRef.current = storedManual as PresenceStatus;
      const socket = getSocket();
      socket.emit("status_update", { status: storedManual });
      return;
    }

    const resetIdleTimer = () => {
      if (manualStatusRef.current) return;

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      setMyStatus((prev) => {
        if (prev !== "online" && !manualStatusRef.current) {
          const socket = getSocket();
          socket.emit("status_update", { status: "online" });
          myStatusRef.current = "online";
          return "online";
        }
        return prev;
      });

      idleTimerRef.current = setTimeout(() => {
        if (manualStatusRef.current) return;
        setMyStatus("idle");
        myStatusRef.current = "idle";
        const socket = getSocket();
        socket.emit("status_update", { status: "idle" });
      }, IDLE_TIMEOUT_MS);
    };

    const activityEvents = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetIdleTimer));

    resetIdleTimer();

    return () => {
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // ===== Build members list =====
  const members = useMemo(() => {
    const membersList: any[] = [];
    // نستخدم مجموعتين للمفاتيح: بالـ id والـ username لضمان عدم التكرار
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    // المستخدم الحالي أولاً
    if (currentMember) {
      const resolvedCountry = userCountries.get(`id:${currentMember.id}`) || userCountries.get(getMemberIdentity(currentMember)) || currentMember.country;
      membersList.push({ ...currentMember, status: myStatus, country: resolvedCountry });
      if (currentMember.id && currentMember.id !== "0") seenIds.add(String(currentMember.id));
      if (currentMember.name) seenNames.add(String(currentMember.name).trim().toLowerCase());
    }

    // المستخدمون المتصلون (بدون تكرار الحالي)
    for (const user of onlineUsers) {
      // تحقق مزدوج: بالـ id وبالاسم لتفادي التكرار أو الـ swap
      const userId = String(user.id || "").trim();
      const userName = String(user.username || "").trim().toLowerCase();
      if (userId && userId !== "0" && seenIds.has(userId)) continue;
      if (userName && seenNames.has(userName)) continue;

      if (userId && userId !== "0") seenIds.add(userId);
      if (userName) seenNames.add(userName);

      const presenceKey = getPresenceKey(user);
      const resolvedStatus = userStatuses.get(presenceKey) || user.status || "online";
      const resolvedCountry = userCountries.get(presenceKey) || user.countryCode || "SA";

      // حساب idreg: يُضاف # إن لم يكن موجوداً
      const idregRaw = user.idreg;
      const idregVal = (() => {
        if (typeof idregRaw === "string" && idregRaw.trim()) {
          return idregRaw.startsWith("#") ? idregRaw : `#${idregRaw}`;
        }
        if (typeof idregRaw === "number") return `#${idregRaw}`;
        // إذا لم يوجد idreg، استخدم الـ id كرقم عضوية
        if (userId && userId !== "0") return `#${userId}`;
        return "";
      })();

      // حساب statusMsg
      const rawStatusMsg = typeof user.statusMsg === "string" ? user.statusMsg.trim() : "";
      const rawProfileMsg = typeof (user as any).profileMsg === "string" ? (user as any).profileMsg.trim() : "";
      const statusMsgVal = rawStatusMsg || rawProfileMsg || (user.role === "guest" ? "( غير مسجل )" : "(عضو جديد)");

      membersList.push({
        id: user.id,
        name: user.username,
        role: user.role,
        rank: user.role === "admin" ? 100 : 0,
        color: user.role === "admin" ? "text-red-600" : "text-foreground",
        bg: "bg-muted",
        status: resolvedStatus,
        room: user.roomId || "",
        country: resolvedCountry,
        points: 0,
        rep: 0,
        avatar: user.avatar || user.avatarUrl || "/pic.png",
        avatarFrameUrl: user.avatarFrameUrl || "",
        memberCardBgUrl: user.memberCardBgUrl || "",
        giftIconUrl: user.giftIconUrl || "",
        nameColor: user.nameColor || "",
        messageColor: user.messageColor || "",
        idreg: idregVal,
        siteBadge: user.siteBadge || "",
        statusMsg: statusMsgVal,
      });
    }

    return membersList;
  }, [currentMember, onlineUsers, myStatus, userStatuses, userCountries]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Stories Bar */}
      <StoriesBar onOpenCreator={() => setStoryCreatorOpen(true)} />

      {/* Online Counter */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <Wifi size={12} className="text-green-500" />
          ) : (
            <WifiOff size={12} className="text-red-500" />
          )}
          <span className="text-[10px] font-bold text-muted-foreground">
            {isConnected ? `${onlineCount} متصل الآن` : "غير متصل بالسيرفر"}
          </span>
        </div>
        <Badge variant="secondary" className="h-4 px-1 text-[9px] font-black bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
          مباشر
        </Badge>
      </div>

      {/* Search Header */}
      {isSearchOpen && (
        <div className="p-3 bg-slate-800 flex items-center gap-2 animate-in slide-in-from-top duration-200 [direction:ltr]">
          <div className="flex-1 relative">
            <Input 
              placeholder="Search .." 
              className="h-9 bg-card/10 border-none text-white placeholder:text-white/50 pl-8 rounded-md text-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <Search className="absolute left-2 top-2.5 text-white/50" size={14} />
          </div>
          <button 
            onClick={() => setIsSearchOpen?.(false)}
            className="bg-red-500 text-white p-1.5 rounded-md hover:bg-red-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Members List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {members.filter(m => m.name.includes(searchQuery)).map((member, index) => {
          const statusCfg = getStatusConfig(member.status);
          return (
          <div 
            key={`${getMemberIdentity(member)}-${member.id || index}`} 
            onClick={() => onOpenProfile?.(member.id)}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-all cursor-pointer border-b border-border/50 [direction:ltr]"
            style={member.memberCardBgUrl ? (
              isHexColor(member.memberCardBgUrl)
                ? { backgroundColor: member.memberCardBgUrl.replace(/^\//, ""), backgroundBlendMode: "overlay" }
                : { backgroundImage: `url(${member.memberCardBgUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
            ) : undefined}
          >
            <div className="relative shrink-0">
              <div
                className="relative grid h-[4.3rem] w-[4.3rem] place-items-center rounded-full"
                style={member.avatarFrameUrl ? { backgroundImage: `url(${member.avatarFrameUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                <Avatar className="w-[3.7rem] h-[3.7rem] rounded-full border-2 border-background shadow-sm">
                  <AvatarImage src={member.avatar} />
                  <AvatarFallback>{member.name[0]}</AvatarFallback>
                </Avatar>
                {/* Status Dot with pulse animation */}
                <span
                  className="absolute bottom-1.5 right-1.5 flex items-center justify-center w-4 h-4"
                  title={statusCfg.label}
                  aria-label={statusCfg.label}
                >
                  {member.status === "online" && (
                    <span className={`absolute inline-flex h-full w-full rounded-full ${statusCfg.pulseColor} opacity-50 animate-ping`} />
                  )}
                  <span className={`relative inline-flex w-3.5 h-3.5 rounded-full border-2 border-background ${statusCfg.color} transition-colors duration-300`} />
                </span>
              </div>
            </div>

            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5">
                  <span className={`font-bold text-xs truncate ${member.color === 'text-foreground' ? 'text-foreground' : member.color}`} style={{ direction: 'rtl', ...(member.nameColor && member.nameColor !== "#000000" ? { color: member.nameColor } : {}) }}>{member.name}</span>
                  {member.siteBadge && (
                    <Badge className="h-3.5 text-[8px] px-1 bg-blue-600 text-white border-none rounded-sm font-black">
                      {member.siteBadge}
                    </Badge>
                  )}
                  {member.giftIconUrl && (
                    <img src={member.giftIconUrl} alt="gift" className="h-4 w-4 rounded object-cover" />
                  )}
                  {/* Status label badge */}
                  {member.status && member.status !== "online" && (
                    <Badge className={`h-3.5 text-[7px] px-1 border-none rounded-sm font-bold text-white ${statusCfg.color}`}>
                      {statusCfg.label}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                   <img src={getCountryFlagSrc(member.country)} alt={member.country} className="h-3 w-4 rounded-sm object-cover" />
                   <span className="text-[9px] text-muted-foreground font-bold">{member.idreg || ""}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground truncate font-medium" style={{ direction: 'rtl', ...(member.messageColor && member.messageColor !== "#000000" ? { color: member.messageColor } : {}) }}>
                  {member.statusMsg || '(عضو جديد)'}
                </p>
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-bold">
                  <span>@{member.name.replace(' ', '')}</span>
                </div>
              </div>
            </div>
          </div>
        );
        })}

        {members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <WifiOff size={32} className="mb-2 opacity-50" />
            <p className="text-xs font-bold">لا يوجد متصلون حالياً</p>
          </div>
        )}
      </div>

      <StoryCreator open={storyCreatorOpen} onClose={() => setStoryCreatorOpen(false)} />
    </div>
  );
};

export default MemberList;
