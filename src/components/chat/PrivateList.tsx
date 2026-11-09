"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MessageCircle, Search, Loader2, RefreshCw } from "lucide-react";
import { getSocket } from "@/lib/socket";
import PrivateChat from "./PrivateChat";
import { useRealtimeStore } from "@/lib/realtime-store";
import { getCountryFlagSrc } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/authSession";

// ─── أنواع البيانات ──────────────────────────────────────────────────────────

type PresenceStatus = "online" | "idle" | "busy" | "away" | "offline";

const STATUS_CONFIG: Record<PresenceStatus, { color: string; pulseColor: string; label: string }> = {
  online:  { color: "bg-green-500",  pulseColor: "bg-green-400",  label: "متصل" },
  idle:    { color: "bg-amber-400",  pulseColor: "bg-amber-300",  label: "بعيد مؤقتاً" },
  busy:    { color: "bg-orange-500", pulseColor: "bg-orange-400", label: "مشغول" },
  away:    { color: "bg-purple-500", pulseColor: "bg-purple-400", label: "غير متواجد" },
  offline: { color: "bg-slate-400",  pulseColor: "bg-slate-300",  label: "غير متصل" },
};

const isHexColor = (v: string) => /^#?[0-9a-fA-F]{3,8}$/.test(v.replace(/^\//, ""));

const getStatusConfig = (status?: string) =>
  STATUS_CONFIG[(status as PresenceStatus) || "offline"] ?? STATUS_CONFIG.offline;

interface PMUser {
  id: string;
  name: string;
  avatar: string;
  nameColor?: string;
}

interface Conversation {
  conversationId: string;
  lastMessage: string;
  lastMessageAt: string;
  otherUser: PMUser;
  unreadCount: number;
}

const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem("user") || "null"); }
  catch { return null; }
};

const fetchPmUser = (userId: string) =>
  fetch(`/api/pm/user?userId=${encodeURIComponent(userId)}`, {
    headers: getAuthHeaders(),
  });

// ─── المكوّن الرئيسي ─────────────────────────────────────────────────────────

const PrivateList = ({
  openWithUserId,
  onChatOpened,
  onOpenProfile,
}: {
  openWithUserId?: string | null;
  onChatOpened?: () => void;
  onOpenProfile?: (userId: string) => void;
}) => {
  const currentUser = getStoredUser();
  const { onlineUsers, pmUnreadCount, setPmUnreadCount } = useRealtimeStore();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedOtherUser, setSelectedOtherUser] = useState<PMUser | null>(null);
  const hasLoadedRef = useRef(false);
  // ref لتجنب stale closure في handler الـ socket
  const selectedConvIdRef = useRef<string | null>(null);
  const pmUnreadRef = useRef(pmUnreadCount);
  const recentPmClientIdsRef = useRef(new Set<string>());

  useEffect(() => { selectedConvIdRef.current = selectedConvId; }, [selectedConvId]);
  useEffect(() => { pmUnreadRef.current = pmUnreadCount; }, [pmUnreadCount]);

  // ─── جلب المحادثات من السيرفر عبر Socket ──────────────────────────────────

  const fetchConversations = useCallback(() => {
    const socket = getSocket();
    if (!socket || !currentUser) return;
    setLoading(true);
    socket.emit("pm:conversations", (res: any) => {
      if (res?.success && Array.isArray(res.conversations)) {
        setConversations(res.conversations);
        const total = res.conversations.reduce((s: number, c: Conversation) => s + c.unreadCount, 0);
        setPmUnreadCount(total);

        // جلب البيانات الحديثة لكل مستخدم لديه اسم "عضو" أو صورة افتراضية
        for (const conv of res.conversations) {
          const other = conv.otherUser;
          if (other?.id && (other.name === "عضو" || other.name === "..." || other.avatar === "/pic.png")) {
            fetchPmUser(other.id)
              .then(r => r.json())
              .then(data => {
                if (data.success && data.user) {
                  setConversations(prev =>
                    prev.map(c =>
                      c.conversationId === conv.conversationId
                        ? { ...c, otherUser: data.user }
                        : c,
                    ),
                  );
                }
              })
              .catch(() => {});
          }
        }
      }
      setLoading(false);
      hasLoadedRef.current = true;
    });
  }, [currentUser?.id, setPmUnreadCount]);

  // ─── التهيئة والاستماع للأحداث ────────────────────────────────────────────

  useEffect(() => {
    fetchConversations();

    const socket = getSocket();
    if (!socket) return;

    // تحديث القائمة عند وصول رسالة جديدة
    const onNewMessage = (msg: any) => {
      if (!msg?.conversationId) return;
      if (msg.clientId) {
        const dedupeKey = `${msg.senderId}:${msg.clientId}`;
        const recentIds = recentPmClientIdsRef.current;
        if (recentIds.has(dedupeKey)) return;
        recentIds.add(dedupeKey);
        if (recentIds.size > 200) {
          const oldestId = recentIds.values().next().value;
          if (oldestId !== undefined) recentIds.delete(oldestId);
        }
      }

      const currentOpenConvId = selectedConvIdRef.current;

      setConversations(prev => {
        const existing = prev.find(c => c.conversationId === msg.conversationId);
        const isOpen = msg.conversationId === currentOpenConvId;

        if (existing) {
          return prev
            .map(c =>
              c.conversationId === msg.conversationId
                ? {
                    ...c,
                    lastMessage: msg.text,
                    lastMessageAt: msg.createdAt,
                    unreadCount: isOpen ? 0 : c.unreadCount + (msg.receiverId === currentUser?.id ? 1 : 0),
                  }
                : c,
            )
            .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        } else {
          const newConv: Conversation = {
            conversationId: msg.conversationId,
            lastMessage: msg.text,
            lastMessageAt: msg.createdAt,
            otherUser: msg.senderId === currentUser?.id
              ? { id: msg.receiverId, name: "عضو", avatar: "/pic.png" }
              : { id: msg.senderId, name: msg.senderName || "عضو", avatar: msg.senderAvatar || "/pic.png" },
            unreadCount: isOpen ? 0 : (msg.receiverId === currentUser?.id ? 1 : 0),
          };
          // جلب البيانات الحقيقية للمستخدم الآخر إذا كان المرسل هو الحالي
          if (msg.senderId === currentUser?.id && msg.receiverId) {
            fetchPmUser(msg.receiverId)
              .then(r => r.json())
              .then(data => {
                if (data.success && data.user) {
                  setConversations(prev =>
                    prev.map(c =>
                      c.conversationId === msg.conversationId
                        ? { ...c, otherUser: data.user }
                        : c,
                    ),
                  );
                }
              })
              .catch(() => {});
          }
          return [newConv, ...prev];
        }
      });

      // تحديث عداد الرسائل غير المقروءة (رقم مباشر)
      if (msg.receiverId === currentUser?.id && msg.conversationId !== currentOpenConvId) {
        setPmUnreadCount(pmUnreadRef.current + 1);
      }
    };

    socket.on("pm:message", onNewMessage);

    // تحديث بيانات المستخدمين عند تغيير البروفايل
    const onUserProfileUpdated = (data: any) => {
      if (!data?.userId) return;
      setConversations(prev =>
        prev.map(c => {
          if (String(c.otherUser.id) === String(data.userId)) {
            return {
              ...c,
              otherUser: {
                ...c.otherUser,
                name: data.username || c.otherUser.name,
                avatar: data.avatar || data.avatarUrl || c.otherUser.avatar,
                ...(data.nameColor !== undefined ? { nameColor: data.nameColor } : {}),
              },
            };
          }
          return c;
        }),
      );
    };
    socket.on("user_profile_updated", onUserProfileUpdated);

    // إعادة الجلب عند إعادة الاتصال (بعد انقطاع)
    const onReconnect = () => {
      fetchConversations();
    };
    socket.on("connect", onReconnect);

    const onConversationExpired = (data: { conversationId?: string }) => {
      if (!data?.conversationId) return;
      setConversations((prev) => {
        const remaining = prev.filter((conversation) =>
          conversation.conversationId !== data.conversationId,
        );
        setPmUnreadCount(remaining.reduce((total, conversation) => total + conversation.unreadCount, 0));
        return remaining;
      });
      if (selectedConvIdRef.current === data.conversationId) {
        selectedConvIdRef.current = null;
        setSelectedConvId(null);
        setSelectedOtherUser(null);
      }
      recentPmClientIdsRef.current.clear();
    };
    socket.on("pm:conversation_expired", onConversationExpired);

    const onAuthLogout = () => {
      setConversations([]);
      setSelectedConvId(null);
      selectedConvIdRef.current = null;
      setSelectedOtherUser(null);
      setPmUnreadCount(0);
      recentPmClientIdsRef.current.clear();
    };
    window.addEventListener("app-auth-logout", onAuthLogout);

    return () => {
      socket.off("pm:message", onNewMessage);
      socket.off("user_profile_updated", onUserProfileUpdated);
      socket.off("connect", onReconnect);
      socket.off("pm:conversation_expired", onConversationExpired);
      window.removeEventListener("app-auth-logout", onAuthLogout);
    };
  }, [fetchConversations, currentUser?.id, setPmUnreadCount]);

  // ─── فتح محادثة مع مستخدم محدد (من ProfileModal) — فوري بدون انتظار ────────

  useEffect(() => {
    if (!openWithUserId || !currentUser) return;

    // حساب الـ conversationId مباشرة — لا نحتاج انتظار تحميل القائمة
    const convId = [currentUser.id, openWithUserId].sort().join(":");

    // محاولة جلب معلومات المستخدم من الأعضاء المتصلين أولاً (فوري)
    const onlineUser = onlineUsers.find(u => String(u.id) === openWithUserId);

    if (onlineUser) {
      // متصل حالياً → نعرف بياناته مباشرة
      setSelectedOtherUser({
        id: openWithUserId,
        name: onlineUser.username || onlineUser.name || "عضو",
        avatar: onlineUser.avatar || "/pic.png",
      });
      setSelectedConvId(convId);
      onChatOpened?.();
    } else {
      // غير متصل → جلب البيانات من API المستخدم (قراءة فقط)
      // نفتح المحادثة أولاً ببيانات مؤقتة ثم نحدّثها
      setSelectedOtherUser({ id: openWithUserId, name: "...", avatar: "/pic.png" });
      setSelectedConvId(convId);
      onChatOpened?.();

      fetchPmUser(openWithUserId)
        .then(r => r.json())
        .then(data => {
          if (data.success && data.user) {
            setSelectedOtherUser(data.user);
          }
        })
        .catch(() => {
          setSelectedOtherUser({ id: openWithUserId, name: "عضو", avatar: "/pic.png" });
        });
    }
  }, [openWithUserId, currentUser?.id]);

  // ─── فتح محادثة محددة ─────────────────────────────────────────────────────

  const openConversation = useCallback((conv: Conversation) => {
    setSelectedConvId(conv.conversationId);
    setSelectedOtherUser(conv.otherUser);
    // تصفير عداد الرسائل غير المقروءة لهذه المحادثة
    setConversations(prev =>
      prev.map(c =>
        c.conversationId === conv.conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    );
    if (conv.unreadCount > 0) {
      setPmUnreadCount(Math.max(0, pmUnreadRef.current - conv.unreadCount));
    }
    // جلب البيانات الحديثة للمستخدم الآخر من قاعدة البيانات
    const otherId = conv.otherUser?.id;
    if (otherId && otherId !== "0") {
      fetchPmUser(otherId)
        .then(r => r.json())
        .then(data => {
          if (data.success && data.user) {
            setSelectedOtherUser(data.user);
            // تحديث البيانات في قائمة المحادثات أيضاً
            setConversations(prev =>
              prev.map(c =>
                c.conversationId === conv.conversationId
                  ? { ...c, otherUser: data.user }
                  : c,
              ),
            );
          }
        })
        .catch(() => {});
    }
  }, [setPmUnreadCount]);

  // ─── تنسيق الوقت ──────────────────────────────────────────────────────────

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      if (diff < 60_000) return "الآن";
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} د`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} س`;
      return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
    } catch { return ""; }
  };

  // ─── عرض نافذة المحادثة ───────────────────────────────────────────────────

  if (selectedConvId && selectedOtherUser) {
    return (
      <PrivateChat
        conversationId={selectedConvId}
        otherUser={selectedOtherUser}
        currentUserId={currentUser?.id || ""}
        onBack={() => {
          setSelectedConvId(null);
          setSelectedOtherUser(null);
          fetchConversations();
        }}
        onOpenProfile={onOpenProfile}
      />
    );
  }

  // ─── قائمة المحادثات ──────────────────────────────────────────────────────

  const filtered = conversations.filter(c =>
    c.otherUser.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full" dir="rtl">

      {/* الهيدر */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-white dark:bg-slate-900 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <Input
            placeholder="بحث في المحادثات..."
            className="h-9 pr-9 text-xs bg-slate-100 dark:bg-slate-800 border-none rounded-xl"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            dir="rtl"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl shrink-0"
          onClick={fetchConversations}
          title="تحديث"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* عداد الرسائل غير المقروءة */}
      {pmUnreadCount > 0 && (
        <div className="mx-4 mt-3 px-3 py-1.5 bg-primary/10 rounded-xl flex items-center gap-2">
          <Badge className="bg-primary text-white text-[9px] font-black rounded-full px-2">
            {pmUnreadCount}
          </Badge>
          <span className="text-[10px] font-bold text-primary">رسائل غير مقروءة</span>
        </div>
      )}

      {/* قائمة المحادثات */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-primary" size={22} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <MessageCircle size={28} className="text-primary" />
            </div>
            <p className="text-sm font-bold text-foreground">
              {searchQuery ? "لا توجد نتائج" : "لا توجد محادثات بعد"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {searchQuery ? "جرّب كلمة بحث أخرى" : "افتح بروفايل أي عضو وابدأ الدردشة"}
            </p>
          </div>
        ) : (
          filtered.map(conv => {
                const onlineUser = onlineUsers.find(u => String(u.id) === String(conv.otherUser.id));
                const resolvedStatus = onlineUser ? (onlineUser.status || "online") : "offline";
                const resolvedAvatarFrame = onlineUser?.avatarFrameUrl || "";
                const resolvedMemberCardBg = onlineUser?.memberCardBgUrl || "";
                const resolvedCountry = onlineUser?.countryCode || "";
                const resolvedIdreg = onlineUser?.idreg || "";
                const resolvedSiteBadge = onlineUser?.siteBadge || "";
                const resolvedGiftIcon = onlineUser?.giftIconUrl || "";
                // استخدام صورة الأونلاين إذا كانت محدثة (أولوية أعلى من الكاش)
                const resolvedAvatar = onlineUser?.avatar || conv.otherUser.avatar || "/pic.png";
                const resolvedName = onlineUser?.username || conv.otherUser.name;
                const resolvedNameColor = onlineUser?.nameColor || conv.otherUser.nameColor || "";
                const resolvedMessageColor = onlineUser?.statusFontColor || "";
            const statusCfg = getStatusConfig(resolvedStatus);

            return (
              <div
                key={conv.conversationId}
                className="group relative flex items-center justify-between p-3.5 rounded-2xl border border-border bg-card hover:bg-muted/50 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={resolvedMemberCardBg ? (
                  isHexColor(resolvedMemberCardBg)
                    ? { backgroundColor: resolvedMemberCardBg.replace(/^\//, "") } as React.CSSProperties
                    : { backgroundImage: `url(${resolvedMemberCardBg})`, backgroundSize: "cover", backgroundPosition: "center" } as React.CSSProperties
                ) : undefined}
                onClick={() => openConversation(conv)}
              >
                {/* الجانب الأيمن: الأفاتار والبيانات */}
                <div className="flex items-center gap-3 min-w-0">
                  {/* الأفاتار مع نقطة الحالة */}
                  <div
                    className="relative shrink-0 cursor-pointer"
                    onClick={e => {
                      e.stopPropagation();
                      onOpenProfile?.(conv.otherUser.id);
                    }}
                  >
                    <div
                      className="relative grid h-12 w-12 place-items-center rounded-full transition hover:scale-105"
                      style={
                        resolvedAvatarFrame
                          ? { backgroundImage: `url(${resolvedAvatarFrame})`, backgroundSize: "cover", backgroundPosition: "center" }
                          : undefined
                      }
                    >
                      <Avatar className="w-11 h-11 rounded-full border-2 border-background shadow-sm">
                        <AvatarImage src={resolvedAvatar} />
                        <AvatarFallback className="rounded-full font-bold">
                          {resolvedName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                    </div>

                    {/* نقطة الحالة */}
                    <span className="absolute bottom-0 right-0 flex items-center justify-center w-4 h-4" title={statusCfg.label}>
                      {resolvedStatus === "online" && (
                        <span className={`absolute inline-flex h-full w-full rounded-full ${statusCfg.pulseColor} opacity-60 animate-ping`} />
                      )}
                      <span className={`relative inline-flex w-3.5 h-3.5 rounded-full border-2 border-background ${statusCfg.color}`} />
                    </span>
                  </div>

                  {/* الاسم والرسالة الأخيرة */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <h4
                        className="font-black text-xs text-foreground truncate hover:underline max-w-[130px]"
                        onClick={e => { e.stopPropagation(); onOpenProfile?.(conv.otherUser.id); }}
                        style={resolvedNameColor && resolvedNameColor !== "#000000" ? { color: resolvedNameColor } : undefined}
                      >
                        {resolvedName}
                      </h4>
                      {resolvedSiteBadge && (
                        <Badge className="h-3.5 text-[7px] px-1 bg-blue-600 text-white border-none rounded font-black shrink-0">
                          {resolvedSiteBadge}
                        </Badge>
                      )}
                      {resolvedGiftIcon && (
                        <img src={resolvedGiftIcon} alt="" className="h-4 w-4 rounded object-cover shrink-0" />
                      )}
                      {resolvedStatus !== "offline" && resolvedStatus !== "online" && (
                        <Badge className={`h-3.5 text-[7px] px-1 border-none rounded font-bold text-white shrink-0 ${statusCfg.color}`}>
                          {statusCfg.label}
                        </Badge>
                      )}
                    </div>
                    <p className={`text-[10px] truncate max-w-[170px] ${
                      conv.unreadCount > 0
                        ? "font-bold text-foreground"
                        : "font-medium text-muted-foreground"
                    }`} style={resolvedMessageColor && resolvedMessageColor !== "#000000" ? { color: resolvedMessageColor } : undefined}>
                      {conv.lastMessage || "لا توجد رسائل بعد"}
                    </p>
                  </div>
                </div>

                {/* الجانب الأيسر: الوقت والبادجات */}
                <div className="flex flex-col items-end justify-between self-stretch shrink-0 gap-1.5">
                  <span className="text-[9px] text-muted-foreground font-bold">
                    {formatTime(conv.lastMessageAt)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {resolvedCountry && (
                      <img
                        src={getCountryFlagSrc(resolvedCountry)}
                        alt={resolvedCountry}
                        className="h-3 w-4 rounded-sm object-cover"
                      />
                    )}
                    {resolvedIdreg && (
                      <span className="text-[8px] text-muted-foreground font-bold">{resolvedIdreg}</span>
                    )}
                    {conv.unreadCount > 0 ? (
                      <Badge className="bg-primary text-white text-[9px] font-black min-w-[18px] h-[18px] flex items-center justify-center rounded-full p-0 animate-pulse">
                        {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                      </Badge>
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary transition-colors" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default PrivateList;