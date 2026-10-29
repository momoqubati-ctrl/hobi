"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Crown, 
  Shield, 
  ShieldCheck, 
  Users, 
  Heart, 
  Share2, 
  Copy, 
  Sparkles, 
  Award, 
  Check,
  X,
  Plus,
  ArrowRight,
  Search,
  Flame,
  Globe,
  Lock,
  Radio,
  Mic,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  FileText,
  Star,
  Wifi
} from "lucide-react";
import { showSuccess, showError } from "@/utils/toast";
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";
import { getLevelBadgeClass, getRoomRoleBadgeInfo } from "./MemberList";

export function RoomVerifiedBadgeIcon({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} aspect-square shrink-0`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* أيقونة شارة التوثيق الرسمية الدائرية المتناظرة هندسياً بنسبة 1:1 */}
      <path
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.67-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
        fill="#1D9BF0"
      />
      <path
        d="M10.54 16.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function formatCount(num: number | undefined | null): string {
  if (!num || isNaN(Number(num))) return "0";
  const n = Number(num);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

interface RoomProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  room?: any;
  members?: any[];
  onOpenProfile?: (userId: string) => void;
}

export const RoomProfileModal: React.FC<RoomProfileModalProps> = ({
  isOpen,
  onClose,
  roomId,
  room,
  members: propMembers,
  onOpenProfile,
}) => {
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [activeBadgeTooltipId, setActiveBadgeTooltipId] = useState<string | null>(null);
  const isTouchDeviceRef = useRef(false);
  const badgesContainerRef = useRef<HTMLDivElement>(null);

  // إغلاق الملاحظة المنبثقة عند النقر في أي مكان خارج الشارات في وضع الهاتف
  useEffect(() => {
    if (!activeBadgeTooltipId) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (badgesContainerRef.current && !badgesContainerRef.current.contains(e.target as Node)) {
        setActiveBadgeTooltipId(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [activeBadgeTooltipId]);

  // Get current user ID from localStorage
  const currentUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem("user");
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(parsed?.id || "");
    } catch {
      return "";
    }
  }, []);

  const fetchProfile = React.useCallback(() => {
    const targetId = String(roomId || room?.id || "").trim();
    if (!targetId) return;
    setLoading(true);
    const socket = getSocket();
    if (socket && socket.connected) {
      socket.emit("room:get_profile", { roomId: targetId }, (res: any) => {
        setLoading(false);
        if (res?.success && res.profile) {
          setProfileData(res.profile);
          setIsLiked(Boolean(res.profile.isLiked));
          setLikesCount(Number(res.profile.likesCount) || 0);
        } else {
          setProfileData(room);
          setLikesCount(Number(room?.likes) || 0);
        }
      });
    } else if (socket) {
      socket.once("connect", () => {
        socket.emit("room:get_profile", { roomId: targetId }, (res: any) => {
          setLoading(false);
          if (res?.success && res.profile) {
            setProfileData(res.profile);
            setIsLiked(Boolean(res.profile.isLiked));
            setLikesCount(Number(res.profile.likesCount) || 0);
          }
        });
      });
    } else {
      setLoading(false);
      setProfileData(room);
      setLikesCount(Number(room?.likes) || 0);
    }
  }, [roomId, room]);

  useEffect(() => {
    if (!isOpen) {
      setShowAllMembers(false);
      setMemberSearchQuery("");
      setIsDescriptionExpanded(false);
      return;
    }
    fetchProfile();
  }, [isOpen, fetchProfile]);

  const activeRoom = profileData || room;
  const level = Number(activeRoom?.level) || 1;
  const realtimeOnlineUsers = useRealtimeStore((state) => state.onlineUsers);

  // Normalizing & ranking members
  const roomMembers: any[] = useMemo(() => {
    const membersMap = new Map<string, any>();

    // 1. Live presence from RoomPage
    if (Array.isArray(propMembers)) {
      for (const m of propMembers) {
        if (!m) continue;
        const key = String(m.id || m.userId || m.username || "").toLowerCase();
        if (key) membersMap.set(key, m);
      }
    }

    // 2. Room profile data from server (with real levels, exp, idreg, power, customTitle)
    if (Array.isArray(profileData?.members)) {
      for (const m of profileData.members) {
        if (!m) continue;
        const key = String(m.id || m.userId || m.username || "").toLowerCase();
        if (key) {
          const existing = membersMap.get(key) || {};
          membersMap.set(key, { ...existing, ...m });
        }
      }
    }

    // 3. Fallback to room.members if still empty
    if (membersMap.size === 0 && Array.isArray(room?.members)) {
      for (const m of room.members) {
        if (!m) continue;
        const key = String(m.id || m.userId || m.username || "").toLowerCase();
        if (key) membersMap.set(key, m);
      }
    }

    // 4. Fallback to realtimeStore onlineUsers if still empty
    if (membersMap.size === 0) {
      const targetRoomId = String(activeRoom?.id || roomId || "");
      const inRoom = (realtimeOnlineUsers || []).filter((u: any) => 
        u && (String(u.roomId) === targetRoomId || String(u.room) === targetRoomId)
      );
      for (const m of inRoom) {
        const key = String(m.id || m.username || "").toLowerCase();
        if (key) membersMap.set(key, m);
      }
    }

    const sourceList = Array.from(membersMap.values());
    const ownerNameLower = String(activeRoom?.owner || "").toLowerCase();
    const ownerIdStr = String(activeRoom?.ownerId || "");
    const ownerIdregStr = String(activeRoom?.ownerIdreg || "").replace(/^#+/, "");

    const normalized = sourceList.map((m: any) => {
      const mId = String(m.id || m.userId || "");
      const mUsername = String(m.username || m.name || "").trim();
      const mUsernameLower = mUsername.toLowerCase();
      const rawIdreg = String(m.idreg || "").replace(/^#+/, "").trim();
      const mIdreg = rawIdreg;

      // فحص هل العضو هو مالك الغرفة
      const isOwner = Boolean(
        (ownerIdStr && mId === ownerIdStr) ||
        (ownerIdregStr && mIdreg === ownerIdregStr) ||
        (ownerNameLower && (mUsernameLower === ownerNameLower || ownerNameLower === `#${mIdreg}` || ownerNameLower === `##${mIdreg}`))
      );

      let roomRole = m.roomRole || (isOwner ? "owner" : (m.role === "admin" || m.role === "owner" ? "super_admin" : (m.role === "moderator" ? "moderator" : (m.role === "guest" ? "guest" : "member"))));
      if (isOwner) roomRole = "owner";

      let roomPower = Number(m.roomPower) || (
        roomRole === "owner" ? 100000 :
        roomRole === "co_owner" ? 80000 :
        roomRole === "super_admin" ? 50000 :
        roomRole === "moderator" ? 30000 :
        roomRole === "vip" ? 10000 :
        roomRole === "member" ? 1000 : 100
      );

      return {
        id: mId || mUsername,
        idreg: mIdreg,
        username: mUsername || "عضو",
        avatar: m.avatar || m.avatarUrl || "/pic.png",
        level: Number(m.level) || 1,
        exp: Number(m.exp) || 0,
        role: m.role || "member",
        roomRole,
        roomPower,
        customTitle: m.customTitle || "",
        status: m.status || "online",
      };
    });

    // إذا كانت القائمة فارغة وكان المستخدم الحالي مسجلاً الدخول، نضيفه كعضو نشط
    if (normalized.length === 0 && currentUserId) {
      try {
        const raw = localStorage.getItem("user");
        if (raw) {
          const u = JSON.parse(raw);
          const uId = String(u.id || "");
          const uIdreg = String(u.idreg || "").replace(/^#+/, "");
          const isOwner = Boolean(
            (ownerIdStr && uId === ownerIdStr) ||
            (ownerIdregStr && uIdreg === ownerIdregStr) ||
            (ownerNameLower && (u.username?.toLowerCase() === ownerNameLower || ownerNameLower === `#${uIdreg}` || ownerNameLower === `##${uIdreg}`))
          );
          normalized.push({
            id: uId,
            idreg: uIdreg,
            username: u.username || u.name || "عضو",
            avatar: u.avatar || "/pic.png",
            level: Number(u.level) || 1,
            exp: Number(u.exp) || 0,
            role: u.role || "member",
            roomRole: isOwner ? "owner" : (u.role === "admin" || u.role === "owner" ? "super_admin" : (u.role === "moderator" ? "moderator" : "member")),
            roomPower: isOwner ? 100000 : 1000,
            customTitle: u.customTitle || "",
            status: "online",
          });
        }
      } catch (_) {}
    }

    // ترتيب الأعضاء تنازلياً بحسب القوة أولاً ثم المستوى ثم نقاط الخبرة
    normalized.sort((a: any, b: any) => {
      if (b.roomPower !== a.roomPower) return b.roomPower - a.roomPower;
      if (b.level !== a.level) return b.level - a.level;
      return b.exp - a.exp;
    });

    return normalized;
  }, [profileData, propMembers, room, activeRoom, roomId, realtimeOnlineUsers, currentUserId]);

  const memberCount = useMemo(() => {
    if (Array.isArray(roomMembers) && roomMembers.length > 0) return roomMembers.length;
    if (typeof activeRoom?.memberCount === "number" && activeRoom.memberCount > 0) return activeRoom.memberCount;
    if (typeof activeRoom?.members === "number" && activeRoom.members > 0) return activeRoom.members;
    return 1;
  }, [activeRoom, roomMembers]);

  const onlineCount = useMemo(() => {
    const onlineFromMembers = roomMembers.filter((m) => m.status === "online").length;
    if (onlineFromMembers > 0) return onlineFromMembers;
    
    const targetRoomId = String(activeRoom?.id || roomId || "");
    const inRoom = (realtimeOnlineUsers || []).filter((u: any) => 
      u && (String(u.roomId) === targetRoomId || String(u.room) === targetRoomId)
    ).length;
    if (inRoom > 0) return inRoom;

    if (typeof activeRoom?.onlineCount === "number" && activeRoom.onlineCount > 0) {
      return activeRoom.onlineCount;
    }
    return memberCount > 0 ? memberCount : 1;
  }, [roomMembers, realtimeOnlineUsers, activeRoom, roomId, memberCount]);

  const ownerDisplayName = useMemo(() => {
    if (profileData?.owner && !profileData.owner.startsWith("#")) {
      return profileData.owner;
    }
    const ownerMember = roomMembers.find((m) => m.roomRole === "owner");
    if (ownerMember?.username) {
      return ownerMember.username;
    }
    if (activeRoom?.owner && !activeRoom.owner.startsWith("#")) {
      return activeRoom.owner;
    }
    return profileData?.owner || activeRoom?.owner || "إدارة الموقع";
  }, [profileData, activeRoom, roomMembers]);

  const ownerMember = useMemo(() => {
    return roomMembers.find((m) => m.roomRole === "owner") || null;
  }, [roomMembers]);

  // قائمة الأشخاص الرئيسيين المعروضين (صاحب الغرفة والمشرفون)
  const displayedPeople = useMemo(() => {
    const list: any[] = [];
    
    if (ownerMember) {
      list.push(ownerMember);
    } else {
      list.push({
        id: "owner",
        username: ownerDisplayName,
        avatar: activeRoom?.ownerAvatar || "/pic.png",
        roomRole: "owner",
        role: "owner",
        level: 1,
      });
    }

    const mods = roomMembers.filter((m) => 
      m.id !== list[0]?.id && 
      (m.roomRole === "co_owner" || m.roomRole === "super_admin" || m.roomRole === "moderator" || m.role === "admin" || m.role === "moderator")
    );
    for (const mod of mods) {
      if (list.length >= 4) break;
      list.push(mod);
    }

    if (list.length < 4) {
      const others = roomMembers.filter((m) => !list.some((p) => p.id === m.id));
      for (const other of others) {
        if (list.length >= 4) break;
        list.push(other);
      }
    }

    return list;
  }, [ownerMember, ownerDisplayName, activeRoom, roomMembers]);

  // قائمة الشارات المعروضة الحقيقية
  const displayedBadges = useMemo(() => {
    if (Array.isArray(activeRoom?.badges) && activeRoom.badges.length > 0) {
      return activeRoom.badges;
    }
    const fallbackBadges: any[] = [];
    if (activeRoom?.verified) {
      fallbackBadges.push({
        id: "verified",
        name: "غرفة موثقة",
        description: "غرفة موثقة",
        icon: "verified",
        type: "verified",
        color: "bg-blue-500",
      });
    }
    const roomLvl = Number(activeRoom?.level) || 1;
    if (roomLvl >= 1) {
      fallbackBadges.push({
        id: "room_level",
        name: `المستوى ${roomLvl}`,
        description: roomLvl >= 25 ? "مستوى أسطوري" : "مستوى مميز",
        icon: "level",
        level: roomLvl,
        type: "level",
        color: roomLvl >= 25 ? "bg-amber-500" : "bg-blue-600",
      });
    }
    if (activeRoom?.badge) {
      fallbackBadges.push({
        id: activeRoom.badge.id || "custom",
        name: activeRoom.badge.name,
        description: "شارة إدارية خاصة",
        icon: activeRoom.badge.icon || "award",
        bg: activeRoom.badge.bg || "",
        type: "custom",
      });
    }
    return fallbackBadges;
  }, [activeRoom]);

  const filteredMembers = useMemo(() => {
    if (!Array.isArray(roomMembers)) return [];
    if (!memberSearchQuery.trim()) return roomMembers;
    const query = memberSearchQuery.toLowerCase().trim();
    return roomMembers.filter(
      (m) =>
        m.username?.toLowerCase().includes(query) ||
        m.id?.toLowerCase().includes(query) ||
        m.idreg?.toLowerCase().includes(query) ||
        m.customTitle?.toLowerCase().includes(query)
    );
  }, [roomMembers, memberSearchQuery]);

  const handleCopyId = () => {
    const idToCopy = activeRoom?.slug || activeRoom?.id || roomId;
    navigator.clipboard.writeText(String(idToCopy));
    setCopied(true);
    showSuccess("تم نسخ معرف الغرفة");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({
        title: activeRoom?.name || "غرفة الدردشة",
        text: activeRoom?.description || "انضم إلى غرفتنا في شات حوبي!",
        url,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url);
      showSuccess("تم نسخ رابط الغرفة بنجاح");
    }
  };

  const handleToggleLike = async () => {
    if (!currentUserId || currentUserId === "0") {
      showError("يجب تسجيل الدخول للإعجاب بالغرفة");
      return;
    }
    if (isLiking) return;

    // تحديث تفاؤلي سريع للواجهة (Optimistic UI)
    const prevLiked = isLiked;
    const prevCount = likesCount;
    setIsLiked(!prevLiked);
    setLikesCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    setIsLiking(true);

    try {
      const res = await fetch("/api/rooms/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: activeRoom?.id || roomId,
          userId: currentUserId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsLiked(Boolean(data.liked));
        if (data.liked) {
          showSuccess("تم الإعجاب بالغرفة ❤️");
        }
      } else {
        setIsLiked(prevLiked);
        setLikesCount(prevCount);
        showError(data.message || "تعذر تحديث الإعجاب");
      }
    } catch {
      setIsLiked(prevLiked);
      setLikesCount(prevCount);
      showError("خطأ في الاتصال");
    } finally {
      setIsLiking(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[460px] p-0 overflow-hidden rounded-[32px] border border-border/60 bg-card shadow-2xl z-[100] [direction:rtl] max-h-[92vh] flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>{activeRoom?.name || "بروفايل الغرفة"}</DialogTitle>
          <DialogDescription>تفاصيل وإحصائيات الغرفة ومستواها وأعضائها</DialogDescription>
        </DialogHeader>

        {showAllMembers ? (
          /* ============================================================== */
          /* عرض كامل قائمة الأعضاء مع الرتب ومستوياتهم مرتبين تنازلياً        */
          /* ============================================================== */
          <div className="flex flex-col h-[580px] bg-card">
            {/* Header with back button */}
            <div className="flex items-center justify-between p-4 border-b border-border/60 bg-muted/30">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAllMembers(false)}
                  className="rounded-xl h-9 w-9 text-foreground hover:bg-muted"
                >
                  <ArrowRight size={20} />
                </Button>
                <div>
                  <h3 className="text-sm font-black text-foreground">
                    أعضاء الغرفة ({roomMembers.length})
                  </h3>
                  <span className="text-[10px] text-muted-foreground font-medium">مرتبون حسب القوة والمستوى</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="rounded-xl h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <X size={18} />
              </Button>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-border/40">
              <div className="relative">
                <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="ابحث عن عضو بالاسم أو المعرف..."
                  className="pr-9 h-9 text-xs rounded-xl bg-muted/50 border-border/60"
                />
              </div>
            </div>

            {/* Members List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredMembers.map((member) => {
                const roleInfo = getRoomRoleBadgeInfo(member.roomRole);
                return (
                  <div
                    key={member.id}
                    onClick={() => {
                      onOpenProfile?.(member.id);
                    }}
                    className="flex items-center justify-between p-2.5 rounded-2xl bg-muted/20 hover:bg-muted/50 border border-border/40 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 rounded-full border border-border shadow-xs">
                          <AvatarImage src={member.avatar} />
                          <AvatarFallback>{member.username?.[0]}</AvatarFallback>
                        </Avatar>
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-card" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                            {member.username}
                          </span>
                          {/* Level Badge */}
                          <span
                            className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[8px] font-black leading-none ${getLevelBadgeClass(member.level)}`}
                          >
                            Lv.{member.level}
                          </span>
                        </div>
                        {member.customTitle ? (
                          <span className="text-[10px] text-amber-500 font-semibold truncate block">
                            {member.customTitle}
                          </span>
                        ) : (
                          <span dir="ltr" className="text-[10px] text-muted-foreground font-medium block">
                            #{member.idreg || member.id?.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Role Badge */}
                    {roleInfo && (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] leading-none shrink-0 ${roleInfo.cls}`}>
                        <span>{roleInfo.icon}</span>
                        <span>{roleInfo.name}</span>
                      </span>
                    )}
                  </div>
                );
              })}

              {filteredMembers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Users size={32} className="mb-2 opacity-40" />
                  <p className="text-xs font-bold">لا يوجد أعضاء مطابقين للبحث</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ============================================================== */
          /* العرض الرئيسي لبروفايل الغرفة - التصميم الاجتماعي الفاخر الحديث */
          /* ============================================================== */
          <>
            <div className="overflow-y-auto flex-1 pb-4">
              {/* 1. رأس البروفايل الفاخر (Header) بتدرج بنفسجي كوني مع الغلاف وموجات الصوت */}
              <div className="relative h-44 w-full bg-gradient-to-b from-[#2a1355] via-[#1f103d] to-[#130928] overflow-hidden flex flex-col justify-between p-4">
                {/* الغلاف إذا توفر */}
                {activeRoom?.coverUrl && (
                  <img 
                    src={activeRoom.coverUrl} 
                    alt="غلاف الغرفة" 
                    className="absolute inset-0 w-full h-full object-cover opacity-35"
                  />
                )}
                
                {/* طبقة التدرج الداكنة الحالمة */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#130928] via-black/40 to-black/30 pointer-events-none" />

                {/* موجات الصوت والمايكروفون المضيء في المنتصف تماماً كما في التصميم المرجعي */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
                  <div className="flex items-center gap-1">
                    <div className="w-1 h-3 bg-purple-400 rounded-full animate-pulse" />
                    <div className="w-1 h-6 bg-purple-400 rounded-full animate-pulse delay-75" />
                    <div className="w-1 h-10 bg-purple-300 rounded-full animate-pulse delay-150" />
                    <div className="w-1 h-5 bg-purple-400 rounded-full animate-pulse delay-100" />
                    <div className="w-14 h-14 rounded-full bg-purple-600/30 border border-purple-400/40 flex items-center justify-center shadow-[0_0_25px_rgba(168,85,247,0.4)] backdrop-blur-xs mx-2">
                      <Mic size={24} className="text-purple-200" />
                    </div>
                    <div className="w-1 h-5 bg-purple-400 rounded-full animate-pulse delay-100" />
                    <div className="w-1 h-10 bg-purple-300 rounded-full animate-pulse delay-150" />
                    <div className="w-1 h-6 bg-purple-400 rounded-full animate-pulse delay-75" />
                    <div className="w-1 h-3 bg-purple-400 rounded-full animate-pulse" />
                  </div>
                </div>

                {/* الصف العلوي في الرأس: زر الإغلاق، شارة الخصوصية، ومستوى الغرفة */}
                <div className="relative z-20 flex items-center justify-between">
                  {/* الجانب الأيمن (RTL): شارة المستوى الفعلي */}
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-md border border-amber-500/40 text-amber-300 text-xs font-black shadow-lg">
                    <Crown size={13} className="text-amber-400 fill-amber-400" />
                    <span>المستوى {level}</span>
                    <Star size={11} className="text-amber-400 fill-amber-400" />
                  </div>

                  {/* الجانب الأيسر: شارة الخصوصية وزر الإغلاق */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-md text-white text-xs font-bold border border-white/10 shadow-sm">
                      {activeRoom?.locked ? <Lock size={12} className="text-amber-400" /> : <Globe size={12} className="text-emerald-400" />}
                      <span>{activeRoom?.locked ? "غرفة خاصة" : "غرفة عامة"}</span>
                    </div>

                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-md transition-all shadow-md cursor-pointer border border-white/10"
                      title="إغلاق"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* الصف السفلي في الرأس: صورة الغرفة، اسمها، والمالك الحقيقي */}
                <div className="relative z-20 flex items-center justify-between gap-3">
                  {/* تفاصيل اسم الغرفة ومالكها */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Crown size={16} className="text-amber-400 fill-amber-400 shrink-0 drop-shadow" />
                      <h2 className="text-lg font-black text-white tracking-tight drop-shadow truncate">
                        {activeRoom?.name || "غرفة الدردشة"}
                      </h2>
                      {activeRoom?.verified && (
                        <RoomVerifiedBadgeIcon className="w-4 h-4 shrink-0 inline-block drop-shadow" />
                      )}
                    </div>
                    <p className="text-xs text-white/85 font-medium truncate mt-0.5">
                      بواسطة <span className="font-bold text-white drop-shadow-sm">{ownerDisplayName}</span>
                    </p>
                  </div>

                  {/* صورة الغرفة مع التوهج ومؤشر الاتصال */}
                  <div className="relative shrink-0">
                    <Avatar className="h-16 w-16 rounded-2xl border-2 border-white/80 shadow-[0_0_20px_rgba(168,85,247,0.5)] ring-2 ring-purple-500/50 bg-background">
                      <AvatarImage src={activeRoom?.avatarUrl || activeRoom?.image || "/pic.png"} className="object-cover" />
                      <AvatarFallback className="text-lg font-black bg-primary text-primary-foreground">
                        {activeRoom?.name?.[0] || "غ"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                  </div>
                </div>
              </div>

              {/* 2. بطاقات الإحصائيات الأربع (Stats Cards) */}
              <div className="grid grid-cols-4 gap-2 px-5 pt-4">
                {/* بطاقة المستوى */}
                <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-muted/30 border border-slate-100 dark:border-border/50 flex flex-col items-center justify-center text-center shadow-xs">
                  <div className="flex items-center gap-1 text-amber-500 mb-0.5">
                    <Star size={13} className="fill-amber-400 text-amber-400" />
                    <span className="font-black text-xs text-foreground">المستوى {level}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">مستوى الغرفة</span>
                </div>

                {/* بطاقة المتصلون الآن */}
                <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-muted/30 border border-slate-100 dark:border-border/50 flex flex-col items-center justify-center text-center shadow-xs">
                  <div className="flex items-center gap-1 text-emerald-500 mb-0.5">
                    <Wifi size={13} className="text-emerald-500" />
                    <span className="font-black text-xs text-foreground">{formatCount(onlineCount)}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">متصلون الآن</span>
                </div>

                {/* بطاقة إجمالي الأعضاء */}
                <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-muted/30 border border-slate-100 dark:border-border/50 flex flex-col items-center justify-center text-center shadow-xs">
                  <div className="flex items-center gap-1 text-blue-500 mb-0.5">
                    <Users size={13} className="text-blue-500" />
                    <span className="font-black text-xs text-foreground">{formatCount(memberCount)}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">الأعضاء</span>
                </div>

                {/* بطاقة الإعجابات */}
                <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-muted/30 border border-slate-100 dark:border-border/50 flex flex-col items-center justify-center text-center shadow-xs">
                  <div className="flex items-center gap-1 text-pink-500 mb-0.5">
                    <Heart size={13} className="fill-pink-500 text-pink-500" />
                    <span className="font-black text-xs text-foreground">{formatCount(likesCount)}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">إعجاب</span>
                </div>
              </div>

              {/* 3. نبذة عن الغرفة (About Room) */}
              <div className="px-5 pt-3.5">
                <div className="p-3.5 rounded-2xl bg-slate-50/80 dark:bg-muted/20 border border-slate-100 dark:border-border/40 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-black text-foreground">
                    <FileText size={14} className="text-purple-600 dark:text-purple-400" />
                    <span>نبذة عن الغرفة</span>
                  </div>
                  {activeRoom?.description ? (
                    <div>
                      <p className={`text-xs text-foreground/85 leading-relaxed ${!isDescriptionExpanded && activeRoom.description.length > 110 ? "line-clamp-2" : ""}`}>
                        {activeRoom.description}
                      </p>
                      {activeRoom.description.length > 110 && (
                        <button
                          type="button"
                          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                          className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline mt-1.5 cursor-pointer"
                        >
                          <span>{isDescriptionExpanded ? "عرض أقل" : "عرض المزيد"}</span>
                          {isDescriptionExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 italic font-medium">
                      لا توجد نبذة محددة لهذه الغرفة حالياً.
                    </p>
                  )}
                </div>
              </div>

              {/* 4. صاحب الغرفة والمشرفون (Owner & Moderators) */}
              <div className="px-5 pt-3.5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-black text-foreground">
                      <ShieldCheck size={15} className="text-indigo-600 dark:text-indigo-400" />
                      <span>صاحب الغرفة والمشرفون</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAllMembers(true)}
                      className="flex items-center gap-0.5 text-[11px] font-bold text-primary hover:underline cursor-pointer"
                    >
                      <span>عرض الكل</span>
                      <ChevronLeft size={13} />
                    </button>
                  </div>

                  {/* شريط الأشخاص الفعليين */}
                  <div className="flex items-start gap-4 overflow-x-auto pb-1 [direction:rtl]">
                    {displayedPeople.map((person, idx) => {
                      const isOwner = person.roomRole === "owner";
                      return (
                        <div
                          key={person.id || idx}
                          onClick={() => {
                            if (person.id && person.id !== "owner") {
                              onOpenProfile?.(person.id);
                            }
                          }}
                          className="flex flex-col items-center text-center shrink-0 w-16 cursor-pointer group"
                        >
                          {/* صورة العضو مع الشارة المناسبة */}
                          <div className="relative mb-1">
                            {isOwner && (
                              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 text-amber-400 drop-shadow">
                                <Crown size={15} className="fill-amber-400" />
                              </div>
                            )}
                            <Avatar className={`h-12 w-12 rounded-full border-2 transition-transform group-hover:scale-105 ${isOwner ? "border-amber-400/80 shadow-md ring-2 ring-purple-500/20" : "border-border shadow-xs"}`}>
                              <AvatarImage src={person.avatar} className="object-cover" />
                              <AvatarFallback className="text-xs font-bold">{person.username?.[0]}</AvatarFallback>
                            </Avatar>
                            {!isOwner && (
                              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border border-card flex items-center justify-center shadow-xs">
                                <Check size={8} className="text-white" strokeWidth={3} />
                              </span>
                            )}
                            {isOwner && (
                              <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[8px] font-black shadow-xs">
                                صاحب الغرفة
                              </div>
                            )}
                          </div>

                          {/* اسم العضو */}
                          <div className="flex items-center justify-center gap-0.5 max-w-[70px] truncate mt-1">
                            <span className="text-[11px] font-bold text-foreground truncate group-hover:text-primary transition-colors">
                              {person.username}
                            </span>
                            {isOwner && <Crown size={10} className="text-amber-500 fill-amber-500 shrink-0" />}
                          </div>

                          {/* المسمى الفعلي للعضو */}
                          <span className="text-[9px] text-muted-foreground font-medium">
                            {isOwner ? "المالك" : (person.roomRole === "co_owner" ? "مساعد" : (person.roomRole === "super_admin" || person.roomRole === "moderator" || person.role === "admin" ? "مشرف" : "عضو"))}
                          </span>
                        </div>
                      );
                    })}

                    {/* زر "+ والمزيد من الأعضاء" */}
                    <div
                      onClick={() => setShowAllMembers(true)}
                      className="flex flex-col items-center text-center shrink-0 w-16 cursor-pointer group"
                    >
                      <div className="h-12 w-12 rounded-full bg-muted/50 border border-dashed border-border/80 flex items-center justify-center text-muted-foreground group-hover:border-primary group-hover:text-primary group-hover:bg-primary/5 transition-all mb-1">
                        <Users size={18} />
                      </div>
                      <span className="text-[10px] font-bold text-muted-foreground group-hover:text-primary transition-colors leading-tight">
                        و المزيد
                      </span>
                      <span className="text-[8px] text-muted-foreground/70 font-medium">
                        من الأعضاء
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. الشارات والإنجازات (Badges & Achievements) */}
              <div className="px-5 pt-3.5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-black text-foreground">
                      <Award size={15} className="text-purple-600 dark:text-purple-400" />
                      <span>الشارات والإنجازات</span>
                    </div>
                    {displayedBadges.length > 0 && (
                      <span className="text-[10px] text-muted-foreground font-semibold">
                        ({displayedBadges.length})
                      </span>
                    )}
                  </div>

                  <div ref={badgesContainerRef} className="flex items-center gap-2.5 overflow-x-auto pb-1 [direction:rtl]">
                    {displayedBadges.length > 0 ? (
                      displayedBadges.map((b: any) => {
                        const isTooltipOpen = activeBadgeTooltipId === b.id;
                        const tooltipText = (b.type === "verified" || b.id === "verified")
                          ? "غرفة موثقة"
                          : (b.description || b.name || "");

                        const handleBadgeTouchStart = () => { isTouchDeviceRef.current = true; };
                        const handleBadgeMouseEnter = () => { if (!isTouchDeviceRef.current) setActiveBadgeTooltipId(b.id); };
                        const handleBadgeMouseLeave = () => { if (!isTouchDeviceRef.current) setActiveBadgeTooltipId(null); };
                        const handleBadgeClick = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          setActiveBadgeTooltipId((prev) => (prev === b.id ? null : b.id));
                          setTimeout(() => { isTouchDeviceRef.current = false; }, 400);
                        };

                        return (
                          <div
                            key={b.id}
                            className="relative p-2.5 rounded-2xl bg-slate-50 dark:bg-muted/30 border border-slate-100 dark:border-border/50 flex flex-col items-center justify-center text-center w-20 shrink-0 shadow-xs"
                          >
                            <button
                              type="button"
                              aria-label={tooltipText}
                              onTouchStart={handleBadgeTouchStart}
                              onMouseEnter={handleBadgeMouseEnter}
                              onMouseLeave={handleBadgeMouseLeave}
                              onClick={handleBadgeClick}
                              className="focus:outline-none w-9 h-9 shrink-0 aspect-square rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center p-0 m-0 border-0 bg-transparent"
                            >
                              {b.type === "verified" || b.id === "verified" ? (
                                <RoomVerifiedBadgeIcon className="w-9 h-9" />
                              ) : b.type === "custom" ? (
                                typeof b.icon === "string" && (b.icon.startsWith("http") || b.icon.startsWith("/")) ? (
                                  <img src={b.icon} alt={b.name} className="w-full h-full object-contain rounded-full" />
                                ) : (
                                  <div className="w-full h-full rounded-full bg-purple-600 text-white flex items-center justify-center shadow-xs">
                                    <Award size={18} />
                                  </div>
                                )
                              ) : b.type === "level" ? (
                                <div className={`w-full h-full rounded-full flex items-center justify-center font-black text-[10px] text-white shadow-xs ${Number(b.level) >= 25 ? "bg-amber-500" : "bg-blue-600"}`}>
                                  Lv.{b.level || level}
                                </div>
                              ) : (
                                <div className="w-full h-full rounded-full bg-orange-500 text-white flex items-center justify-center shadow-xs">
                                  <Flame size={18} className="fill-white" />
                                </div>
                              )}
                            </button>

                            <span className="text-[10px] font-bold text-foreground truncate w-full mt-1.5">
                              {b.name}
                            </span>
                            <span className="text-[8px] text-muted-foreground truncate w-full">
                              {b.type === "verified" ? "غرفة معتمدة" : (b.description || "شارة مميزة")}
                            </span>

                            {/* الملاحظة التوضيحية عند التمرير بالماوس أو النقر في الهاتف */}
                            {isTooltipOpen && (
                              <div
                                role="tooltip"
                                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 text-xs font-bold text-white bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur-sm rounded-lg shadow-xl border border-white/10 whitespace-nowrap pointer-events-none animate-in fade-in-0 zoom-in-95 duration-150"
                              >
                                <span>{tooltipText}</span>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-slate-900/95 dark:border-t-slate-800/95" />
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="w-full py-3 px-4 rounded-2xl bg-muted/20 border border-dashed border-border/60 text-center">
                        <span className="text-xs text-muted-foreground/60 italic font-medium">
                          لا توجد شارات ممنوحة لهذه الغرفة حالياً
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 6. أزرار الإجراءات السفلية الثابتة (Action Buttons) */}
            <div className="p-4 border-t border-border/50 bg-card/95 backdrop-blur-sm flex items-center gap-2.5 [direction:rtl] shrink-0">
              {/* زر الخيارات / نسخ المعرف */}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopyId}
                className="rounded-2xl h-11 w-11 shrink-0 border-border/80 hover:bg-muted text-muted-foreground hover:text-foreground shadow-xs"
                title={copied ? "تم النسخ" : `نسخ المعرف #${activeRoom?.slug || activeRoom?.id?.slice(0, 6)}`}
              >
                {copied ? <Check size={18} className="text-emerald-500" /> : <MoreHorizontal size={18} />}
              </Button>

              {/* زر الإعجاب */}
              <Button
                type="button"
                onClick={handleToggleLike}
                disabled={isLiking}
                className={`flex-1 rounded-2xl h-11 gap-2 font-black text-xs transition-all shadow-md ${
                  isLiked
                    ? "bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-pink-500/25"
                    : "bg-pink-500 hover:bg-pink-600 text-white shadow-pink-500/20"
                }`}
              >
                <Heart size={18} className="fill-white" />
                <span>{isLiked ? "معجب" : "إعجاب"}</span>
                <span className="text-[11px] opacity-90">({formatCount(likesCount)})</span>
              </Button>

              {/* زر مشاركة الغرفة */}
              <Button
                type="button"
                onClick={handleShare}
                variant="outline"
                className="flex-1 rounded-2xl h-11 gap-2 font-black text-xs border-border/80 hover:bg-muted text-foreground transition-all shadow-xs"
              >
                <Share2 size={16} />
                <span>مشاركة الغرفة</span>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
