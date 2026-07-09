"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Heart, Users, Mic2, Lock, ShieldCheck, Loader2, DoorOpen, Volume2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeStore } from "@/lib/realtime-store";
import { getSocket } from "@/lib/socket";
import { showError } from "@/utils/toast";

type Room = {
  id: string;
  name: string;
  description: string;
  members: number;
  maxMembers: number;
  likesRequired: number;
  mics: number;
  likes: number;
  locked: boolean;
  owner: string;
  image: string;
  color?: string;
  welcome?: string;
  verified?: boolean;
  roomLayout?: string;
  broadcast?: boolean;
  userLiked?: boolean;
};

const LAYOUT_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  normal: DoorOpen,
  modern_voice: Volume2,
  live_broadcast: Video,
};

const DashboardRooms = ({
  onSelectRoom,
  onLockedRoom,
  activeRoomId,
}: {
  onSelectRoom: (room: Room, password?: string) => void;
  onLockedRoom: (room: Room) => void;
  activeRoomId?: string;
}) => {
  const {
    rooms,
    isLoadingRooms: isLoading,
    isRoomsLoaded,
    setRooms,
    setLoadingRooms,
  } = useRealtimeStore();

  const [likedRooms, setLikedRooms] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [likingRoomId, setLikingRoomId] = useState<string | null>(null);
  const [likedLoaded, setLikedLoaded] = useState(false);

  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();

  const fetchLikedState = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const response = await fetch(`/api/rooms?userId=${currentUser.id}`);
      const data = await response.json();
      if (data.success && data.rooms) {
        const liked = new Set<string>();
        const counts: Record<string, number> = {};
        for (const room of data.rooms) {
          if (room.userLiked) liked.add(room.id);
          counts[room.id] = room.likes || 0;
        }
        setLikedRooms(liked);
        setLikeCounts(counts);
        setLikedLoaded(true);
      }
    } catch {}
  }, [currentUser?.id]);

  useEffect(() => {
    if (isRoomsLoaded && !likedLoaded) {
      fetchLikedState();
    }
  }, [isRoomsLoaded, likedLoaded, fetchLikedState]);

  useEffect(() => {
    if (isRoomsLoaded) return;
    let ignore = false;
    const loadRooms = async () => {
      try {
        setLoadingRooms(true);
        const userIdParam = currentUser?.id ? `?userId=${currentUser.id}` : "";
        const response = await fetch(`/api/rooms${userIdParam}`);
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "تعذر تحميل الغرف");
        }
        if (!ignore) {
          setRooms(data.rooms);
          const liked = new Set<string>();
          const counts: Record<string, number> = {};
          for (const room of data.rooms) {
            if (room.userLiked) liked.add(room.id);
            counts[room.id] = room.likes || 0;
          }
          setLikedRooms(liked);
          setLikeCounts(counts);
          setLikedLoaded(true);
        }
      } catch {
        if (!ignore) {
          setLoadingRooms(false);
        }
      }
    };
    loadRooms();
    return () => {
      ignore = true;
    };
  }, [isRoomsLoaded, setRooms, setLoadingRooms, currentUser?.id]);

  useEffect(() => {
    const socket = getSocket();
    const handleRoomsUpdated = (payload: { rooms?: any[]; cmd?: string; data?: any[] }) => {
      if (payload?.rooms) {
        setRooms(payload.rooms);
      } else if (payload?.cmd === "r+" && Array.isArray(payload.data)) {
        setRooms(payload.data);
      }
    };
    socket.on("rooms_updated", handleRoomsUpdated);
    socket.on("msg", handleRoomsUpdated);
    return () => {
      socket.off("rooms_updated", handleRoomsUpdated);
      socket.off("msg", handleRoomsUpdated);
    };
  }, [setRooms]);

  useEffect(() => {
    if (!rooms.length) return;
    setLikeCounts((prev) => {
      const next = { ...prev };
      for (const r of rooms) {
        if (!(r.id in next)) {
          next[r.id] = r.likes || 0;
        }
      }
      return next;
    });
  }, [rooms]);

  const handleLike = useCallback(
    async (room: Room, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentUser?.id) {
        showError("يجب تسجيل الدخول أولاً");
        return;
      }
      if (likingRoomId) return;

      const wasLiked = likedRooms.has(room.id);
      const prevCount = likeCounts[room.id] ?? room.likes ?? 0;

      setLikingRoomId(room.id);

      setLikedRooms((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.delete(room.id);
        else next.add(room.id);
        return next;
      });
      setLikeCounts((prev) => ({
        ...prev,
        [room.id]: wasLiked ? Math.max(0, (prev[room.id] || 0) - 1) : (prev[room.id] || 0) + 1,
      }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const token = localStorage.getItem("authToken");
        const res = await fetch("/api/rooms/likes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
          },
          body: JSON.stringify({ roomId: room.id, userId: currentUser.id }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        if (!data.success) {
          setLikedRooms((prev) => {
            const next = new Set(prev);
            if (wasLiked) next.add(room.id);
            else next.delete(room.id);
            return next;
          });
          setLikeCounts((prev) => ({ ...prev, [room.id]: prevCount }));
        }
      } catch {
        clearTimeout(timeoutId);
        setLikedRooms((prev) => {
          const next = new Set(prev);
          if (wasLiked) next.add(room.id);
          else next.delete(room.id);
          return next;
        });
        setLikeCounts((prev) => ({ ...prev, [room.id]: prevCount }));
      } finally {
        setLikingRoomId(null);
      }
    },
    [currentUser, likedRooms, likeCounts, likingRoomId]
  );

  const handleJoin = useCallback(
    (room: Room) => {
      if (room.members >= (room.maxMembers || 50)) {
        showError("الغرفة ممتلئة حالياً");
        return;
      }
      if (room.locked) {
        onLockedRoom(room);
      } else {
        onSelectRoom(room);
      }
    },
    [onSelectRoom, onLockedRoom]
  );

  const topRooms = rooms
    .filter((r) => r.members > 0)
    .sort((a, b) => (b.members || 0) - (a.members || 0))
    .slice(0, 10);

  const allRooms = rooms.slice(0, 20);
  const displayRooms = topRooms.length > 0 ? topRooms : allRooms;

  if (isLoading && !isRoomsLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      {displayRooms.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Volume2 size={16} className="text-primary" />
              </div>
              الغرف النشطة
            </h3>
            <span className="text-xs font-bold text-muted-foreground">{displayRooms.length} غرفة</span>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-none [direction:ltr]">
            {displayRooms.map((room) => {
              const LayoutIcon = LAYOUT_ICONS[room.roomLayout || "normal"] || DoorOpen;
              const isLiked = likedRooms.has(room.id);
              const currentLikeCount = likeCounts[room.id] ?? room.likes ?? 0;
              const isFull = room.members >= (room.maxMembers || 50);
              const isCurrentRoom = activeRoomId === room.id;
              const isLiking = likingRoomId === room.id;

              return (
                <div
                  key={room.id}
                  className={`group relative w-[260px] shrink-0 overflow-hidden rounded-2xl border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                    isCurrentRoom
                      ? "border-primary shadow-lg shadow-primary/10"
                      : "border-slate-100 dark:border-slate-800 hover:border-primary/30"
                  } bg-white dark:bg-slate-900`}
                >
                  <div className="relative h-[160px] overflow-hidden">
                    <img
                      src={room.image || "/pic.png"}
                      alt={room.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                    {room.locked && (
                      <div className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                        <Lock className="text-white" size={12} />
                      </div>
                    )}
                    {room.verified && (
                      <div className="absolute top-3 left-3 flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 shadow-md">
                        <ShieldCheck size={12} className="text-white" />
                      </div>
                    )}

                    <div className="absolute bottom-3 left-3 right-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <h4 className="truncate text-base font-black text-white drop-shadow-lg [direction:rtl]">
                          {room.name}
                        </h4>
                        <LayoutIcon size={14} className="text-white/80 shrink-0" />
                      </div>
                      <p className="line-clamp-1 text-[11px] text-white/70 [direction:rtl]">
                        {room.description || "غرفة دردشة"}
                      </p>
                    </div>
                  </div>

                  <div className="p-3">
                    <div className="flex items-center gap-3 mb-3 text-[10px] font-bold text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users size={12} className={isFull ? "text-red-500" : "text-green-500"} />
                        <span className={isFull ? "text-red-500" : ""}>
                          {room.members}/{room.maxMembers || 50}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-pink-500">
                        <Heart size={12} fill={isLiked ? "currentColor" : "none"} />
                        <span>{currentLikeCount}</span>
                      </div>
                      {room.mics > 0 && (
                        <div className="flex items-center gap-1">
                          <Mic2 size={12} className="text-blue-500" />
                          <span>{room.mics}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={(e) => handleLike(room, e)}
                        size="sm"
                        className={`flex-1 rounded-xl h-9 text-xs font-black transition-all ${
                          isLiked
                            ? "bg-pink-500 hover:bg-pink-600 text-white shadow-md shadow-pink-500/20"
                            : "bg-pink-50 text-pink-500 hover:bg-pink-100 border border-pink-200"
                        }`}
                        disabled={isLiking}
                      >
                        {isLiking ? (
                          <Loader2 className="animate-spin mx-auto" size={14} />
                        ) : (
                          <>
                            <Heart size={14} fill={isLiked ? "currentColor" : "none"} className="ml-1" />
                            إعجاب
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleJoin(room)}
                        size="sm"
                        className={`flex-1 rounded-xl h-9 text-xs font-black shadow-md transition-all ${
                          isFull
                            ? "bg-slate-400 text-white cursor-not-allowed"
                            : "bg-primary text-white hover:bg-primary/90 shadow-primary/20"
                        }`}
                        disabled={isFull}
                      >
                        {isFull ? "ممتلئة" : "انضمام"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {displayRooms.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 dark:bg-slate-800">
            <DoorOpen size={32} className="text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-base font-black text-slate-800 dark:text-white">لا توجد غرف حالياً</h3>
          <p className="text-sm text-muted-foreground">لم يتم إنشاء أي غرفة بعد</p>
        </div>
      )}
    </div>
  );
};

export default DashboardRooms;
