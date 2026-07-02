"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, Lock, Mic2, Heart, Search, Plus, Loader2, X, Check, ShieldCheck, Layout, ImagePlus, Palette, Key, DoorOpen, MessageCircle, UserCheck, Volume2, Video, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";
import { showSuccess, showError } from "@/utils/toast";

type Room = {
  id: string;
  name: string;
  description: string;
  members: number;
  mics: number;
  likes: number;
  locked: boolean;
  owner: string;
  image: string;
  color?: string;
  welcome?: string;
  verified?: boolean;
  roomLayout?: string;
};

const ROOM_LAYOUTS = [
  { value: "normal", label: "عادي", icon: DoorOpen, desc: "غرفة دردشة نصية عادية" },
  { value: "modern_voice", label: "غرفة صوتي حديث", icon: Volume2, desc: "غرفة صوتية متطورة مع مايكات" },
  { value: "live_broadcast", label: "غرفة بث مباشر", icon: Video, desc: "غرفة بث مباشر مع stage" },
];

const RoomList = ({ onSelectRoom }: { onSelectRoom: (room: Room) => void }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const {
    rooms,
    isLoadingRooms: isLoading,
    isRoomsLoaded,
    setRooms,
    setLoadingRooms,
    updateRoomMemberCount
  } = useRealtimeStore();
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "create">("list");
  const [canCreateRoom, setCanCreateRoom] = useState(false);

  // التحقق من صلاحية إنشاء الغرف
  useEffect(() => {
    const user = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
    if (user?.role === "admin" || user?.role === "owner") {
      setCanCreateRoom(true);
    }
  }, []);

  useEffect(() => {
    if (isRoomsLoaded) return;

    let ignore = false;
    const loadRooms = async () => {
      try {
        setError("");
        setLoadingRooms(true);
        const response = await fetch("/api/rooms");
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "تعذر تحميل الغرف");
        }

        if (!ignore) {
          setRooms(data.rooms);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "تعذر تحميل الغرف");
          setLoadingRooms(false);
        }
      }
    };

    loadRooms();

    const socket = getSocket();
    const handleRoomsUpdated = (payload: any) => {
      if (payload?.rooms) {
        setRooms(payload.rooms);
      } else if (payload?.cmd === "r+" && Array.isArray(payload.data)) {
        setRooms(payload.data);
      }
    };
    socket.on("rooms_updated", handleRoomsUpdated);
    socket.on("msg", handleRoomsUpdated);

    return () => {
      ignore = true;
      socket.off("rooms_updated", handleRoomsUpdated);
      socket.off("msg", handleRoomsUpdated);
    };
  }, [isRoomsLoaded, setRooms, setLoadingRooms]);

  const filteredRooms = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rooms;
    return rooms.filter((room) => `${room.name} ${room.description} ${room.owner}`.toLowerCase().includes(query));
  }, [rooms, searchQuery]);

  return (
    <div className="flex h-full flex-col bg-card [direction:ltr]">
      {view === "list" ? (
        <>
          <div className="flex items-center gap-1.5 bg-[#2c3e50] p-1.5">
            <div className="relative flex-1">
              <Input
                placeholder="ابحث عن غرفة"
                className="h-7 rounded-md border-none bg-card/10 pl-7 text-[10px] text-white placeholder:text-white/60"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Search className="absolute left-2 top-2 text-white/50" size={12} />
            </div>
            {canCreateRoom && (
              <button
                onClick={() => setView("create")}
                className="rounded-md bg-green-500 p-1 text-white transition-colors hover:bg-green-600"
                type="button"
                title="إنشاء غرفة جديدة"
              >
                <Plus size={14} />
              </button>
            )}
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {isLoading && (
              <div className="flex h-24 items-center justify-center text-muted-foreground">
                <Loader2 className="animate-spin" size={18} />
              </div>
            )}

            {!isLoading && error && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-center text-xs font-bold text-red-600" dir="rtl">
                {error}
              </div>
            )}

            {!isLoading && !error && filteredRooms.length === 0 && (
              <div className="rounded-lg border border-border bg-muted p-3 text-center text-xs font-bold text-muted-foreground" dir="rtl">
                لا توجد غرف مطابقة
              </div>
            )}

            {filteredRooms.map((room) => (
              <button
                key={room.id}
                onClick={() => onSelectRoom(room)}
                className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border-b border-border/50 p-2 text-left transition-all hover:bg-slate-100 [direction:ltr]"
                type="button"
              >
                <div className="relative shrink-0">
                  <img src={room.image} alt={room.name} className="h-12 w-12 rounded-lg object-cover shadow-sm" />
                  {room.locked && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                      <Lock className="text-white" size={12} />
                    </div>
                  )}
                  {room.verified && (
                    <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 shadow-sm">
                      <ShieldCheck size={8} className="text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {room.roomLayout && room.roomLayout !== "normal" && (
                        <span className="text-[8px] text-muted-foreground" title={ROOM_LAYOUTS.find(l => l.value === room.roomLayout)?.label}>
                          {room.roomLayout === "modern_voice" ? "🎤" : "📺"}
                        </span>
                      )}
                      <h4 className="truncate text-xs font-black text-foreground" dir="rtl">
                        {room.name}
                      </h4>
                    </div>
                    <div className="flex items-center gap-1 text-pink-500">
                      <Heart size={10} fill="currentColor" />
                      <span className="text-[9px] font-bold">{room.likes}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5 text-muted-foreground">
                        <Users size={10} />
                        <span className="text-[9px] font-bold">{room.members}</span>
                      </div>
                      <div className="flex items-center gap-0.5 text-muted-foreground">
                        <Mic2 size={10} />
                        <span className="text-[9px] font-bold">{room.mics}</span>
                      </div>
                    </div>
                    <span className="rounded-sm bg-primary/5 px-1.5 py-0.5 text-[9px] font-bold text-primary" dir="rtl">
                      {room.owner}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <CreateRoomInline onBack={() => setView("list")} onCreated={() => setView("list")} />
      )}
    </div>
  );
};

// ─── مكوّن إنشاء غرفة جديدة (داخل النافذة الجانبية) ──────────────────────────

const CreateRoomInline = ({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) => {
  const [topic, setTopic] = useState("");
  const [about, setAbout] = useState("");
  const [welcome, setWelcome] = useState("");
  const [pass, setPass] = useState("");
  const [max, setMax] = useState("10");
  const [like, setLike] = useState("0");
  const [mic, setMic] = useState("0");
  const [broadcast, setBroadcast] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [color, setColor] = useState("#2563EB");
  const [pic, setPic] = useState("");
  const [verified, setVerified] = useState(false);
  const [roomLayout, setRoomLayout] = useState("normal");
  const [stageLocks, setStageLocks] = useState<Record<string, boolean>>({});
  const [isCreating, setIsCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // مزامنة stageLocks عند تغيير عدد المايكات مع تفعيل البث
  useEffect(() => {
    if (!broadcast || mic === "0" || !mic) {
      setStageLocks({});
      return;
    }
    const count = parseInt(mic, 10) || 0;
    setStageLocks((prev) => {
      const next: Record<string, boolean> = {};
      for (let i = 1; i <= count; i++) {
        next[String(i)] = prev[String(i)] ?? false;
      }
      return next;
    });
  }, [mic, broadcast]);

  const toggleStageLock = (key: string) => {
    setStageLocks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCreate = async () => {
    if (!topic.trim()) { showError("اسم الغرفة مطلوب"); return; }
    if (!about.trim()) { showError("وصف الغرفة مطلوب"); return; }
    if (!welcome.trim()) { showError("رسالة الترحيب مطلوبة"); return; }

    setIsCreating(true);
    const socket = getSocket();
    if (!socket?.connected) {
      showError("الاتصال بالخادم غير متاح");
      setIsCreating(false);
      return;
    }

    const timeout = setTimeout(() => {
      setIsCreating(false);
      showError("انتهت مهلة الطلب، تحقق من اتصالك");
    }, 15000);

    socket.emit("create_room", {
      topic: topic.trim(),
      about: about.trim(),
      welcome: welcome.trim(),
      pass: pass || "",
      max: parseInt(max, 10) || 10,
      like: parseInt(like, 10) || 0,
      pinned,
      broadcast,
      mic: parseInt(mic, 10) || 0,
      pic: pic || "room.png",
      color,
      verified,
      roomLayout,
      stageLocks: broadcast ? stageLocks : {},
    }, (res: any) => {
      clearTimeout(timeout);
      setIsCreating(false);
      if (res?.success) {
        showSuccess("تم إنشاء الغرفة بنجاح");
        onCreated();
      } else {
        showError(res?.message || "فشل إنشاء الغرفة");
      }
    });
  };

  const handleImageUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setPic(event.target?.result as string || "");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex h-full flex-col bg-card" dir="rtl">
      <div className="flex items-center gap-1.5 bg-[#2c3e50] p-1.5">
        <button onClick={onBack} className="rounded-md p-1 text-white transition-colors hover:bg-white/10" type="button" title="عودة">
          <X size={14} />
        </button>
        <h3 className="text-xs font-black text-white">إنشاء غرفة جديدة</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* اسم الغرفة */}
        <div className="space-y-1">
          <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <Hash size={14} /> اسم الغرفة
          </Label>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="عنوان الغرفة"
            className="rounded-xl text-xs font-bold"
            maxLength={80}
          />
        </div>

        {/* وصف الغرفة */}
        <div className="space-y-1">
          <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <MessageCircle size={14} /> وصف الغرفة
          </Label>
          <Input
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="الوصف المختصر للغرفة"
            className="rounded-xl text-xs font-bold"
            maxLength={200}
          />
        </div>

        {/* رسالة الترحيب */}
        <div className="space-y-1">
          <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <UserCheck size={14} /> رسالة الترحيب
          </Label>
          <Input
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
            placeholder="أهلاً بك {user} في الغرفة"
            className="rounded-xl text-xs font-bold"
            maxLength={200}
          />
          <p className="text-[9px] text-muted-foreground">المتغيرات المدعومة: {'{user}'} {'{room}'} {'{rank}'}</p>
        </div>

        {/* نوع التصميم */}
        <div className="space-y-1">
          <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <Layout size={14} /> نوع التصميم
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {ROOM_LAYOUTS.map((layout) => {
              const Icon = layout.icon;
              const isActive = roomLayout === layout.value;
              return (
                <button
                  key={layout.value}
                  type="button"
                  onClick={() => setRoomLayout(layout.value)}
                  className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 text-center transition-all ${
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:bg-muted"
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-[8px] font-bold">{layout.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* الإعدادات - صف مزدوج */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Users size={14} /> عدد الأعضاء
            </Label>
            <Input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              placeholder="10"
              min={2}
              max={40}
              className="rounded-xl text-xs font-bold"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Mic2 size={14} /> عدد المايكات
            </Label>
            <Input
              type="number"
              value={mic}
              onChange={(e) => setMic(e.target.value)}
              placeholder="0"
              min={0}
              max={5}
              className="rounded-xl text-xs font-bold"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Heart size={14} /> إيكات الدخول
            </Label>
            <Input
              type="number"
              value={like}
              onChange={(e) => setLike(e.target.value)}
              placeholder="0"
              min={0}
              className="rounded-xl text-xs font-bold"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Key size={14} /> كلمة المرور
            </Label>
            <Input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="اختياري"
              className="rounded-xl text-xs font-bold"
            />
          </div>
        </div>

        {/* لون الغرفة */}
        <div className="space-y-1">
          <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <Palette size={14} /> لون الغرفة
          </Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-10 cursor-pointer rounded-xl border border-border"
            />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="rounded-xl text-xs font-bold font-mono"
              maxLength={7}
            />
          </div>
        </div>

        {/* صورة الغرفة */}
        <div className="space-y-1">
          <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
            <ImagePlus size={14} /> صورة الغرفة
          </Label>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
              {pic ? (
                <img src={pic} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImagePlus size={16} />
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImageUpload}
              className="rounded-xl text-xs font-bold"
            >
              اختيار صورة
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        {/* الخيارات - تشك بوكسات */}
        <div className="flex flex-wrap gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={broadcast}
              onChange={(e) => setBroadcast(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-xs font-bold text-muted-foreground">تشغيل المايك (broadcast)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-xs font-bold text-muted-foreground">غرفة مثبتة</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
              <ShieldCheck size={14} className="text-blue-500" /> غرفة موثقة
            </span>
          </label>
        </div>

        {/* الاستيجات - تظهر فقط عند تفعيل البث وعدد مايكات > 0 */}
        {broadcast && (parseInt(mic, 10) || 0) > 0 && (
          <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3">
            <Label className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Mic2 size={14} /> التحكم بالاستيجات
            </Label>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: parseInt(mic, 10) || 0 }, (_, i) => {
                const key = String(i + 1);
                const locked = stageLocks[key] ?? false;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleStageLock(key)}
                    className={`flex flex-col items-center gap-0.5 rounded-lg border py-2 text-center transition-all ${
                      locked
                        ? "border-red-300 bg-red-50 text-red-600"
                        : "border-green-300 bg-green-50 text-green-600"
                    }`}
                    title={locked ? "مقفل" : "مفتوح"}
                  >
                    <Lock size={locked ? 14 : 12} className={locked ? "text-red-500" : "text-green-500"} />
                    <span className="text-[9px] font-bold">{key}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[9px] text-muted-foreground">اضغط على الاستيج لتبديل حالة القفل</p>
          </div>
        )}

        {/* أزرار الإجراءات */}
        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="flex-1 rounded-xl text-xs font-bold"
            disabled={isCreating}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            className="flex-1 rounded-xl bg-green-600 text-xs font-bold text-white hover:bg-green-700 shadow-md"
            disabled={isCreating}
          >
            {isCreating ? (
              <><Loader2 className="animate-spin" size={14} /> إنشاء...</>
            ) : (
              <><Plus size={14} /> إنشاء الغرفة</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RoomList;
