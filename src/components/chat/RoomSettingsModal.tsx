"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { showSuccess, showError } from "@/utils/toast";
import { useRealtimeStore } from "@/lib/realtime-store";
import { RoomPermissionGroupsTab } from "./RoomPermissionGroupsTab";
import {
  Settings,
  ImagePlus,
  Loader2,
  X,
  Mic2,
  Users,
  Shield,
  Palette,
  MessageSquare,
  Search,
  Check,
} from "lucide-react";

export interface RoomFormState {
  name: string;
  slug: string;
  description: string;
  maxMembers: string;
  micSlots: string;
  isPublic: boolean;
  password: string;
  avatarUrl: string;
  ownerUsername: string;
  likesRequired: string;
  roomColor: string;
  isPinned: boolean;
  welcomeMessage: string;
  localSendMode: string;
}

const defaultFormState: RoomFormState = {
  name: "",
  slug: "",
  description: "",
  maxMembers: "50",
  micSlots: "5",
  isPublic: true,
  password: "",
  avatarUrl: "",
  ownerUsername: "",
  likesRequired: "0",
  roomColor: "#000000",
  isPinned: false,
  welcomeMessage: "",
  localSendMode: "real",
};

interface RoomSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  room?: any;
  members?: { id: string; username: string }[];
  canManagePermissionGroups?: boolean;
  onRoomUpdated?: (updatedRoom: any) => void;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  isOpen,
  onClose,
  roomId,
  room,
  members = [],
  canManagePermissionGroups = false,
  onRoomUpdated,
}) => {
  const [form, setForm] = useState<RoomFormState>(defaultFormState);
  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  // Search owners
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerResults, setOwnerResults] = useState<
    { id: string; username: string; displayName: string; avatar: string }[]
  >([]);
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const [searchingOwners, setSearchingOwners] = useState(false);
  const ownerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerContainerRef = useRef<HTMLDivElement>(null);

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem("authToken");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  // Initialize form from props and then fetch latest DB record
  useEffect(() => {
    if (!isOpen) return;

    if (room) {
      setForm({
        name: room.name || room.topic || "",
        slug: room.slug || room.id || "",
        description: room.description || room.about || "",
        maxMembers: String(room.maxMembers || room.max || 50),
        micSlots: String(room.micSlots || room.mics || room.stageCount || 5),
        isPublic: room.isPublic !== undefined ? Boolean(room.isPublic) : !room.locked,
        password: room.password || "",
        avatarUrl: room.avatarUrl || room.image || room.pic || "",
        ownerUsername: room.ownerUsername || room.ownerName || room.owner || "",
        likesRequired: String(room.likesRequired || room.rmli || 0),
        roomColor: room.roomColor || room.color || "#000000",
        isPinned: Boolean(room.isPinned || room.broadcast),
        welcomeMessage: room.welcomeMessage || room.welcome || "",
        localSendMode: room.localSendMode || room.messageMode || "real",
      });
    }

    const fetchLatestRoom = async () => {
      try {
        setIsFetchingDetails(true);
        const res = await fetch(`/api/admin/rooms/${roomId}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.room) {
            const r = data.room;
            setForm((prev) => ({
              ...prev,
              name: r.name || prev.name,
              slug: r.slug || prev.slug,
              description: r.description !== undefined ? r.description : prev.description,
              maxMembers: String(r.maxMembers || prev.maxMembers),
              micSlots: String(r.micSlots || prev.micSlots),
              isPublic: r.isPublic !== undefined ? Boolean(r.isPublic) : prev.isPublic,
              password: r.password !== undefined ? r.password : prev.password,
              avatarUrl: r.avatarUrl || prev.avatarUrl,
              ownerUsername: r.ownerUsername || r.ownerName || prev.ownerUsername,
              likesRequired: String(r.likesRequired ?? prev.likesRequired),
              roomColor: r.roomColor || r.color || prev.roomColor,
              isPinned: Boolean(r.isPinned ?? r.broadcast ?? prev.isPinned),
              welcomeMessage: r.welcomeMessage !== undefined ? r.welcomeMessage : prev.welcomeMessage,
              localSendMode: r.localSendMode || r.messageMode || prev.localSendMode,
            }));
          }
        }
      } catch (err) {
        console.warn("Failed to fetch fresh room details:", err);
      } finally {
        setIsFetchingDetails(false);
      }
    };

    fetchLatestRoom();
  }, [isOpen, roomId, room, getAuthHeaders]);

  // Click outside to close owner search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        ownerContainerRef.current &&
        !ownerContainerRef.current.contains(e.target as Node)
      ) {
        setShowOwnerDropdown(false);
      }
    };
    if (showOwnerDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showOwnerDropdown]);

  const handleChange = (key: keyof RoomFormState, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const searchOwners = (q: string) => {
    setOwnerSearch(q);
    setShowOwnerDropdown(true);
    if (ownerSearchTimer.current) clearTimeout(ownerSearchTimer.current);
    if (!q.trim()) {
      setOwnerResults([]);
      return;
    }
    setSearchingOwners(true);
    ownerSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/users-search?q=${encodeURIComponent(q.trim())}`,
          { headers: getAuthHeaders() }
        );
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          setOwnerResults(data.users);
        } else {
          setOwnerResults([]);
        }
      } catch {
        setOwnerResults([]);
      } finally {
        setSearchingOwners(false);
      }
    }, 300);
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    try {
      // First try upload via /api/wall/upload for persistent storage
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        if (!base64) {
          setIsUploadingImage(false);
          return;
        }

        try {
          const token = localStorage.getItem("authToken");
          const res = await fetch("/api/wall/upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              file: base64,
              filename: file.name,
              contentType: file.type,
            }),
          });
          const data = await res.json();
          if (data.success && data.url) {
            handleChange("avatarUrl", data.url);
          } else {
            handleChange("avatarUrl", base64);
          }
        } catch {
          handleChange("avatarUrl", base64);
        } finally {
          setIsUploadingImage(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showError("اسم الغرفة مطلوب");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/rooms/${roomId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (data.success) {
        showSuccess(data.message || "تم تحديث بيانات الغرفة بنجاح");

        const updatedRoom = {
          ...room,
          id: roomId,
          name: form.name,
          slug: form.slug,
          description: form.description,
          maxMembers: Number(form.maxMembers) || 50,
          micSlots: Number(form.micSlots) || 5,
          mics: Number(form.micSlots) || 5,
          stageCount: Number(form.micSlots) || 5,
          isPublic: form.isPublic,
          locked: !form.isPublic || Boolean(form.password),
          password: form.password,
          image: form.avatarUrl || room?.image,
          avatarUrl: form.avatarUrl || room?.avatarUrl,
          color: form.roomColor,
          roomColor: form.roomColor,
          owner: form.ownerUsername || room?.owner,
          ownerUsername: form.ownerUsername,
          welcome: form.welcomeMessage,
          welcomeMessage: form.welcomeMessage,
          broadcast: form.isPinned ? 1 : 0,
          isPinned: form.isPinned,
          localSendMode: form.localSendMode,
          likesRequired: Number(form.likesRequired) || 0,
        };

        // Update realtime store rooms list
        const store = useRealtimeStore.getState();
        if (store.rooms && Array.isArray(store.rooms)) {
          const updatedRooms = store.rooms.map((r: any) =>
            String(r.id) === String(roomId) || String(r.slug) === String(roomId)
              ? { ...r, ...updatedRoom }
              : r
          );
          store.setRooms(updatedRooms);
        }

        onRoomUpdated?.(updatedRoom);
        onClose();
      } else {
        showError(data.message || "حدث خطأ أثناء حفظ التعديلات");
      }
    } catch (err: any) {
      showError("حدث خطأ أثناء حفظ الغرفة");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-border/40 bg-card p-0 shadow-2xl [direction:rtl]">
        {/* Header */}
        <DialogHeader className="sticky top-0 z-10 border-b border-border/50 bg-card/95 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Settings size={22} />
              </div>
              <div>
                <DialogTitle className="text-lg font-black text-foreground">
                  إدارة الغرفة المباشرة
                </DialogTitle>
                <DialogDescription className="text-xs font-bold text-muted-foreground">
                  {form.name || "تعديل إعدادات وخصائص الغرفة"}
                  {form.slug ? ` • @${form.slug}` : ""}
                </DialogDescription>
              </div>
            </div>
            {isFetchingDetails && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span>مزامنة...</span>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className={`grid ${canManagePermissionGroups ? "grid-cols-5" : "grid-cols-4"} h-12 w-full rounded-2xl bg-muted/60 p-1`}>
              <TabsTrigger
                value="general"
                className="rounded-xl text-xs font-bold gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                <Palette size={14} />
                <span>الأساسية</span>
              </TabsTrigger>
              <TabsTrigger
                value="mics"
                className="rounded-xl text-xs font-bold gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                <Mic2 size={14} />
                <span>المايكات</span>
              </TabsTrigger>
              <TabsTrigger
                value="ownership"
                className="rounded-xl text-xs font-bold gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                <Users size={14} />
                <span>الملكية</span>
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="rounded-xl text-xs font-bold gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
              >
                <Shield size={14} />
                <span>الأمان</span>
              </TabsTrigger>
              {canManagePermissionGroups && (
                <TabsTrigger
                  value="permission-groups"
                  className="rounded-xl text-xs font-bold gap-1.5 data-[state=active]:bg-card data-[state=active]:shadow-sm"
                >
                  <Shield size={14} />
                  <span>الصلاحيات</span>
                </TabsTrigger>
              )}
            </TabsList>

            {/* TAB 1: General Info */}
            <TabsContent value="general" className="mt-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">
                    اسم الغرفة <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="مثال: الغرفة العامة"
                    className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold focus:border-primary"
                    value={form.name}
                    onChange={(e) => handleChange("name", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">
                    الرابط المباشر (slug) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="room-slug"
                    className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold [direction:ltr]"
                    value={form.slug}
                    onChange={(e) => handleChange("slug", e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-bold text-muted-foreground mr-1 text-xs">الوصف</Label>
                <Textarea
                  placeholder="وصف ترحيبي بموضوع الغرفة وقوانينها..."
                  className="rounded-2xl bg-muted/40 border-border/50 font-bold resize-none"
                  value={form.description}
                  onChange={(e) => handleChange("description", e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                {/* Avatar */}
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">صورة الغرفة</Label>
                  <div className="flex items-center gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-muted/40 shadow-sm relative">
                      {form.avatarUrl ? (
                        <img
                          src={form.avatarUrl}
                          alt="Room avatar"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
                          <ImagePlus size={22} />
                        </div>
                      )}
                      {isUploadingImage && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Loader2 size={18} className="animate-spin text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isUploadingImage}
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl text-xs font-bold gap-1.5 h-9"
                      >
                        <ImagePlus size={15} /> اختيار صورة جديدة
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageFileChange}
                      />
                      {form.avatarUrl && (
                        <button
                          type="button"
                          onClick={() => handleChange("avatarUrl", "")}
                          className="text-[11px] font-bold text-destructive hover:underline text-right"
                        >
                          إزالة الصورة
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Color */}
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">لون الغرفة</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-11 w-14 rounded-2xl border border-border/50 bg-muted/40 cursor-pointer p-1"
                      value={form.roomColor || "#000000"}
                      onChange={(e) => handleChange("roomColor", e.target.value)}
                    />
                    <Input
                      placeholder="#000000"
                      className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold [direction:ltr]"
                      value={form.roomColor}
                      onChange={(e) => handleChange("roomColor", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: Mics & Capacity */}
            <TabsContent value="mics" className="mt-5 space-y-4">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 text-primary font-black text-sm">
                  <Mic2 size={18} />
                  <span>المنصة الصوتية المباشرة</span>
                </div>
                <p className="text-xs text-muted-foreground font-semibold mt-1">
                  حدد عدد المايكات المتاحة للمتحدثين على الاستيج داخل الغرفة
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={form.micSlots === "5" ? "default" : "outline"}
                    onClick={() => handleChange("micSlots", "5")}
                    className="rounded-xl font-black text-xs h-8"
                  >
                    5 مايكات
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.micSlots === "12" ? "default" : "outline"}
                    onClick={() => handleChange("micSlots", "12")}
                    className="rounded-xl font-black text-xs h-8"
                  >
                    12 مايك
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">
                    عدد المايكات
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    max="50"
                    placeholder="5"
                    className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold"
                    value={form.micSlots}
                    onChange={(e) => handleChange("micSlots", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">
                    السعة القصوى للأعضاء
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="50"
                    className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold"
                    value={form.maxMembers}
                    onChange={(e) => handleChange("maxMembers", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-muted-foreground mr-1 text-xs">
                    الإعجابات المطلوبة للدخول
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold"
                    value={form.likesRequired}
                    onChange={(e) => handleChange("likesRequired", e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>

            {/* TAB 3: Ownership & Messages */}
            <TabsContent value="ownership" className="mt-5 space-y-4">
              <div className="space-y-2 relative" ref={ownerContainerRef}>
                <Label className="font-bold text-muted-foreground mr-1 text-xs">
                  مالك الغرفة
                </Label>
                <div className="relative">
                  <Input
                    placeholder="ابحث عن عضو لتعيينه مالكاً..."
                    className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold pl-10"
                    value={form.ownerUsername || ownerSearch}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, ownerUsername: "" }));
                      searchOwners(e.target.value);
                    }}
                    onFocus={() => {
                      if (ownerSearch) setShowOwnerDropdown(true);
                    }}
                  />
                  {form.ownerUsername ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({ ...prev, ownerUsername: "" }));
                        setOwnerSearch("");
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X size={15} />
                    </button>
                  ) : (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                      <Search size={15} />
                    </div>
                  )}
                </div>

                {showOwnerDropdown && ownerSearch && (
                  <div className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-2xl border border-border/60 bg-card shadow-xl p-1">
                    {searchingOwners ? (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="animate-spin h-5 w-5 text-primary" />
                      </div>
                    ) : ownerResults.length === 0 ? (
                      <div className="p-4 text-center text-xs font-bold text-muted-foreground">
                        لا توجد نتائج مطابقة
                      </div>
                    ) : (
                      ownerResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, ownerUsername: u.username }));
                            setOwnerSearch("");
                            setShowOwnerDropdown(false);
                          }}
                          className="flex w-full items-center justify-between p-2.5 rounded-xl text-right transition-colors hover:bg-muted/60"
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={u.avatar || "/pic.png"}
                              className="h-8 w-8 rounded-full object-cover border border-border"
                              alt=""
                            />
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-foreground">
                                {u.displayName}
                              </span>
                              <span className="text-[10px] font-bold text-muted-foreground">
                                @{u.username}
                              </span>
                            </div>
                          </div>
                          {form.ownerUsername === u.username && (
                            <Check size={16} className="text-primary" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="font-bold text-muted-foreground mr-1 text-xs">
                  رسالة الترحيب بالغرفة
                </Label>
                <Textarea
                  placeholder="رسالة تلقائية تظهر للداخلين إلى الغرفة..."
                  className="rounded-2xl bg-muted/40 border-border/50 font-bold resize-none"
                  value={form.welcomeMessage}
                  onChange={(e) => handleChange("welcomeMessage", e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label className="font-bold text-muted-foreground mr-1 text-xs">
                  نوع الإرسال
                </Label>
                <Select
                  value={form.localSendMode || "real"}
                  onValueChange={(v) => handleChange("localSendMode", v)}
                >
                  <SelectTrigger className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold">
                    <SelectValue placeholder="اختر نوع الإرسال" />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border-border/60">
                    <SelectItem value="real" className="font-bold">
                      واقعي (Real)
                    </SelectItem>
                    <SelectItem value="fake" className="font-bold">
                      وهمي (Fake)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* TAB 4: Security & Visibility */}
            <TabsContent value="security" className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label className="font-bold text-muted-foreground mr-1 text-xs">
                  كلمة المرور للغرفة
                </Label>
                <Input
                  type="password"
                  placeholder="اترك فارغاً إن كانت عامة بدون كلمة مرور"
                  className="h-11 rounded-2xl bg-muted/40 border-border/50 font-bold [direction:ltr]"
                  value={form.password}
                  onChange={(e) => handleChange("password", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="flex items-center justify-between p-4 rounded-2xl border border-border/50 bg-muted/20">
                  <div className="space-y-0.5">
                    <Label className="font-black text-sm text-foreground">غرفة عامة</Label>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      السماح للجميع بالدخول مباشرة
                    </p>
                  </div>
                  <Switch
                    checked={form.isPublic}
                    onCheckedChange={(v) => handleChange("isPublic", v)}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl border border-border/50 bg-muted/20">
                  <div className="space-y-0.5">
                    <Label className="font-black text-sm text-foreground">
                      مثبتة (بث عام)
                    </Label>
                    <p className="text-[11px] font-bold text-muted-foreground">
                      تظهر في أعلى قائمة الغرف والبث
                    </p>
                  </div>
                  <Switch
                    checked={form.isPinned}
                    onCheckedChange={(v) => handleChange("isPinned", v)}
                  />
                </div>
              </div>
            </TabsContent>

            {canManagePermissionGroups && (
              <TabsContent value="permission-groups">
                <RoomPermissionGroupsTab
                  roomId={roomId}
                  members={members}
                  getAuthHeaders={getAuthHeaders}
                />
              </TabsContent>
            )}
          </Tabs>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-3 border-t border-border/50">
            <Button
              type="submit"
              disabled={loading || isUploadingImage}
              className="flex-1 h-12 rounded-2xl font-black bg-primary text-primary-foreground hover:bg-primary/90 shadow-md gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Check size={18} />
                  <span>حفظ التغييرات</span>
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="h-12 px-6 rounded-2xl font-black text-muted-foreground hover:bg-muted"
            >
              إلغاء
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RoomSettingsModal;
