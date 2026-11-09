"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Heart, MessageCircle, Gift, UserPlus, UserMinus, Loader2, Users, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRealtimeStore } from "@/lib/realtime-store";
import { getSocket } from "@/lib/socket";
import { showError, showSuccess } from "@/utils/toast";

type OnlineMember = {
  id: string;
  socketId?: string;
  username: string;
  displayName?: string;
  mentionName?: string;
  publicUserId?: string;
  role: string;
  avatar: string;
  countryCode?: string;
  status?: string;
  nameColor?: string;
  roomId?: string;
};

type MemberStats = {
  avatar: string;
  cover: string;
  statusMsg: string;
  nameColor: string;
  avatarFrameUrl: string;
  giftedBannerUrl: string;
  giftedGiftIconUrl: string;
  giftedPromotionIconUrl: string;
  roleIconUrl: string;
  memberCardBgUrl: string;
  evaluation: number;
  rep: number;
  coins: number;
  likes: number;
  giftsReceivedCount: number;
  followerCount: number;
  followingCount: number;
  isFollowedByMe: boolean;
};

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-amber-400",
  busy: "bg-orange-500",
  away: "bg-purple-500",
};

const DashboardMembers = ({
  onOpenChat,
  onOpenProfile,
}: {
  onOpenChat?: (userId: string) => void;
  onOpenProfile?: (userId: string) => void;
}) => {
  const { onlineUsers, isOnlineUsersLoaded } = useRealtimeStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [memberStats, setMemberStats] = useState<Record<string, MemberStats>>({});
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const statsFetchedRef = useRef(false);

  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();

  const isGuest = !currentUser?.id || currentUser?.role === "guest";

  const filteredMembers = onlineUsers.filter((member: OnlineMember) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        member.displayName?.toLowerCase().includes(q) || member.username?.toLowerCase().includes(q) || member.mentionName?.toLowerCase().includes(q) ||
        member.id?.toString().includes(q)
      );
    }
    return member.id !== currentUser?.id;
  });

  useEffect(() => {
    if (!isOnlineUsersLoaded || statsFetchedRef.current) return;
    const ids = filteredMembers.slice(0, 20).map((m: OnlineMember) => m.id).filter(Boolean);
    if (ids.length === 0) return;
    statsFetchedRef.current = true;

    const fetchStats = async () => {
      try {
        const params = new URLSearchParams({ ids: ids.join(",") });
        if (currentUser?.id) params.set("currentUserId", currentUser.id);
        const res = await fetch(`/api/users/batch-stats?${params.toString()}`);
        const data = await res.json();
        if (data.success && data.stats) {
          setMemberStats(data.stats);
        }
      } catch {}
    };
    fetchStats();
  }, [isOnlineUsersLoaded, filteredMembers, currentUser?.id]);

  useEffect(() => {
    statsFetchedRef.current = false;
  }, [onlineUsers.length]);

  const handleFollow = useCallback(
    async (member: OnlineMember, e: React.MouseEvent) => {
      e.stopPropagation();
      if (isGuest) {
        showError("يجب عليك تسجيل عضوية أولاً للاستفادة من هذه الميزة والعديد من الميزات الأخرى");
        return;
      }
      if (!currentUser?.id) {
        showError("يجب تسجيل الدخول أولاً");
        return;
      }
      if (followingUserId) return;

      const wasFollowed = memberStats[member.id]?.isFollowedByMe || false;
      const prevCount = memberStats[member.id]?.followerCount || 0;

      setFollowingUserId(member.id);

      setMemberStats((prev) => ({
        ...prev,
        [member.id]: {
          ...prev[member.id],
          isFollowedByMe: !wasFollowed,
          followerCount: wasFollowed ? Math.max(0, prevCount - 1) : prevCount + 1,
        } as MemberStats,
      }));

      try {
        const socket = getSocket();
        const result = await new Promise<{ success?: boolean; following?: boolean; followerCount?: number; error?: string }>((resolve) => {
          socket.emit("profile:follow", { profileId: member.id }, resolve);
        });
        if (result.error) {
          setMemberStats((prev) => ({
            ...prev,
            [member.id]: {
              ...prev[member.id],
              isFollowedByMe: wasFollowed,
              followerCount: prevCount,
            } as MemberStats,
          }));
          showError(result.error);
        } else {
          if (result.followerCount !== undefined) {
            setMemberStats((prev) => ({
              ...prev,
              [member.id]: {
                ...prev[member.id],
                isFollowedByMe: result.following,
                followerCount: result.followerCount!,
              } as MemberStats,
            }));
          }
          showSuccess(result.following ? "تم المتابعة" : "تم إلغاء المتابعة");
        }
      } catch {
        setMemberStats((prev) => ({
          ...prev,
          [member.id]: {
            ...prev[member.id],
            isFollowedByMe: wasFollowed,
            followerCount: prevCount,
          } as MemberStats,
        }));
      } finally {
        setFollowingUserId(null);
      }
    },
    [currentUser, isGuest, memberStats, followingUserId]
  );

  const handleChat = useCallback(
    (member: OnlineMember) => {
      if (isGuest) {
        showError("يجب عليك تسجيل عضوية أولاً للاستفادة من هذه الميزة");
        return;
      }
      if (onOpenChat) {
        onOpenChat(member.id);
      }
    },
    [onOpenChat, isGuest]
  );

  const handleGift = useCallback(
    (member: OnlineMember) => {
      if (isGuest) {
        showError("يجب عليك تسجيل عضوية أولاً للاستفادة من هذه الميزة");
        return;
      }
      if (onOpenProfile) {
        onOpenProfile(member.id);
      }
    },
    [onOpenProfile, isGuest]
  );

  if (!isOnlineUsersLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Users size={16} className="text-green-500" />
            </div>
            المتواجدون الآن
          </h3>
          <span className="text-xs font-bold text-muted-foreground">{filteredMembers.length} عضو</span>
        </div>

        <div className="mb-4">
          <div className="relative">
            <Input
              name="member-search-dashboard"
              placeholder="ابحث عن عضو..."
              autoComplete="off"
              className="h-9 rounded-xl text-xs font-bold pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="absolute left-3 top-2.5 text-muted-foreground" size={14} />
          </div>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-none [direction:ltr]">
          {filteredMembers.slice(0, 20).map((member: OnlineMember) => {
            const stats = memberStats[member.id];
            const isFollowed = stats?.isFollowedByMe || false;
            const isFollowing = followingUserId === member.id;
            const statusColor = STATUS_COLORS[member.status || "online"] || STATUS_COLORS.online;
            const followerCount = stats?.followerCount || 0;
            const followingCount = stats?.followingCount || 0;
            const likeCount = stats?.likes || 0;
            const pointsCount = stats?.coins || 0;

            return (
              <div
                key={member.id}
                onClick={() => onOpenProfile?.(member.id)}
                className="group relative w-[280px] shrink-0 overflow-hidden rounded-2xl border-2 border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-primary/30 cursor-pointer"
              >
                <div className="relative h-[100px] overflow-hidden">
                  <img
                    src={stats?.cover || "/pich.png"}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    <div className={`h-3 w-3 rounded-full ${statusColor} border-2 border-white shadow-sm`} />
                    {stats?.giftedBannerUrl && (
                      <img src={stats.giftedBannerUrl} alt="" className="h-5 w-5 rounded-full" />
                    )}
                    {stats?.giftedGiftIconUrl && (
                      <img src={stats.giftedGiftIconUrl} alt="" className="h-5 w-5" />
                    )}
                    {stats?.giftedPromotionIconUrl && (
                      <img src={stats.giftedPromotionIconUrl} alt="" className="h-5 w-5" />
                    )}
                  </div>
                </div>

                <div className="relative px-4 pb-4">
                  <div className="relative -mt-10 mb-3 flex justify-center" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(member.id); }}>
                    <div className="relative">
                      <img
                        src={stats?.avatar || member.avatar || "/pic.png"}
                        alt={member.displayName || member.username}
                        className="h-[72px] w-[72px] rounded-[22px] object-cover shadow-xl ring-4 ring-white dark:ring-slate-900"
                      />
                      {stats?.avatarFrameUrl && (
                        <img
                          src={stats.avatarFrameUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full rounded-[22px] pointer-events-none"
                        />
                      )}
                      <div className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ${statusColor} border-2 border-white dark:border-slate-900`} />
                    </div>
                  </div>

                  <div className="text-center mb-3" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(member.id); }}>
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <h4
                        className="text-sm font-black text-slate-800 dark:text-white [direction:rtl]"
                        style={stats?.nameColor ? { color: stats.nameColor } : member.nameColor ? { color: member.nameColor } : undefined}
                      >
                        {member.displayName || member.username}
                      </h4>
                      {stats?.roleIconUrl && (
                        <img src={stats.roleIconUrl} alt="" className="h-4 w-4" />
                      )}
                      {member.role === "admin" && (
                        <span className="px-1.5 py-0.5 rounded-md bg-red-500 text-white text-[8px] font-black">ADMIN</span>
                      )}
                      {member.role === "owner" && (
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-500 text-white text-[8px] font-black">OWNER</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-1" dir="rtl">
                      {stats?.statusMsg || "عضو في المجتمع"}
                    </p>
                  </div>

                  <div className="flex items-center justify-center gap-3 mb-3 text-[10px] font-bold text-muted-foreground">
                    <div className="flex items-center gap-1" title="المتابعين">
                      <UserMinus size={11} className="text-blue-500" />
                      <span>{followerCount}</span>
                      <span className="text-[9px]">متابعين</span>
                    </div>
                    <div className="flex items-center gap-1" title="يتابع">
                      <UserPlus size={11} className="text-purple-500" />
                      <span>{followingCount}</span>
                      <span className="text-[9px]">يتابع</span>
                    </div>
                    <div className="flex items-center gap-1" title="الإعجابات">
                      <Heart size={11} className="text-pink-500" fill="currentColor" />
                      <span>{likeCount}</span>
                      <span className="text-[9px]">إعجاب</span>
                    </div>
                    <div className="flex items-center gap-1" title="النقاط">
                      <Star size={11} className="text-amber-500" />
                      <span>{pointsCount}</span>
                      <span className="text-[9px]">نقاط</span>
                    </div>
                  </div>

                  <div className="flex gap-1.5">
                    <Button
                      onClick={(e) => handleFollow(member, e)}
                      size="sm"
                      className={`flex-1 rounded-xl h-8 p-0 transition-all ${
                        isFollowed
                          ? "bg-blue-500 hover:bg-blue-600 text-white shadow-md shadow-blue-500/20"
                          : "bg-blue-50 text-blue-500 hover:bg-blue-100 border border-blue-200"
                      }`}
                      disabled={isFollowing}
                      title={isFollowed ? "إلغاء المتابعة" : "متابعة"}
                    >
                      {isFollowing ? (
                        <Loader2 className="animate-spin" size={14} />
                      ) : isFollowed ? (
                        <UserMinus size={14} />
                      ) : (
                        <UserPlus size={14} />
                      )}
                    </Button>
                    <Button
                      onClick={(e) => { e.stopPropagation(); handleGift(member); }}
                      size="sm"
                      className="flex-1 rounded-xl h-8 p-0 bg-pink-50 text-pink-500 hover:bg-pink-100 border border-pink-200 transition-all"
                      title="إعجاب"
                    >
                      <Heart size={14} />
                    </Button>
                    <Button
                      onClick={() => handleChat(member)}
                      size="sm"
                      className="flex-1 rounded-xl h-8 p-0 bg-green-50 text-green-500 hover:bg-green-100 border border-green-200 transition-all"
                      title="دردشة خاصة"
                    >
                      <MessageCircle size={14} />
                    </Button>
                    <Button
                      onClick={() => handleGift(member)}
                      size="sm"
                      className="flex-1 rounded-xl h-8 p-0 bg-amber-50 text-amber-500 hover:bg-amber-100 border border-amber-200 transition-all"
                      title="هدية"
                    >
                      <Gift size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredMembers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center w-full">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <Users size={24} className="text-muted-foreground" />
              </div>
              <h3 className="mb-1 text-sm font-black text-slate-800 dark:text-white">لا يوجد أعضاء متواجدون</h3>
              <p className="text-xs text-muted-foreground">لم يتم العثور على نتائج</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardMembers;
