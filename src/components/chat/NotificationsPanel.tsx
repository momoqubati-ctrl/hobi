"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Heart, MessageCircle, Gift, Reply, Loader2, CheckCheck, UserPlus, AtSign, Mail } from 'lucide-react';
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";

interface NotificationItem {
  id: string;
  userId: string;
  actorId: string;
  type: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, any>;
  readAt: string | null;
  createdAt: string;
  actor: { name: string; avatar: string; nameColor?: string };
  isRead?: boolean; // توافقاً مع Zustand store
}

const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "الآن";
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} د`;
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} س`;
  return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
};

const NotificationIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "like": return <Heart size={14} className="text-red-500" />;
    case "comment": return <MessageCircle size={14} className="text-blue-500" />;
    case "reply": return <Reply size={14} className="text-green-500" />;
    case "gift": return <Gift size={14} className="text-pink-500" />;
    case "follow": return <UserPlus size={14} className="text-primary" />;
    case "mention": return <AtSign size={14} className="text-amber-500" />;
    case "mail": return <Mail size={14} className="text-purple-500" />;
    default: return <Bell size={14} className="text-slate-400" />;
  }
};

const getNotificationText = (n: NotificationItem) => {
  const postBody = n.metadata?.postBody;
  const commentBody = n.metadata?.commentBody;
  const parentCommentBody = n.metadata?.parentCommentBody;
  const postSnippet = postBody ? `: "${postBody}${postBody.length >= 80 ? "..." : ""}"` : "";
  const commentSnippet = commentBody ? `: "${commentBody}${commentBody.length >= 20 ? "..." : ""}"` : "";
  const parentSnippet = parentCommentBody ? `: "${parentCommentBody}${parentCommentBody.length >= 20 ? "..." : ""}"` : "";
  switch (n.type) {
    case "like": return n.entityType === "wall_comment" ? `أعجب بتعليقك${commentSnippet}` : `أعجب بمنشورك${postSnippet}`;
    case "comment": return `علّق على منشورك${postSnippet}`;
    case "reply": return `رد على تعليقك${parentSnippet}`;
    case "gift": return `أرسل لك ${n.metadata.giftIcon || "🎁"} ${n.metadata.giftName || "هدية"}`;
    case "follow": return "بدأ بمتابعتك";
    case "mention": return "أشار إليك في منشور";
    case "mail": {
      const preview = n.metadata?.preview;
      return `أرسل لك رسالة خاصة${preview ? `: "${preview}${preview.length >= 80 ? "..." : ""}"` : ""}`;
    }
    default: return "تفاعل معك";
  }
};

export const NotificationsBell = ({ onOpen }: { onOpen: () => void }) => {
  const { notificationUnreadCount } = useRealtimeStore();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative rounded-xl"
      onClick={onOpen}
    >
      <Bell size={20} />
      {notificationUnreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 text-[8px] font-black text-white px-1">
          {notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}
        </span>
      )}
    </Button>
  );
};

interface NotificationsListProps {
  compact?: boolean;
  onClose?: () => void;
}

const NotificationsList = ({ compact, onClose }: NotificationsListProps) => {
  const currentUser = getStoredUser();
  const {
    notifications,
    notificationUnreadCount,
    isLoadingNotifications: loading,
    markNotificationRead,
    markAllNotificationsRead,
    onlineUsers,
  } = useRealtimeStore();

  const handleMarkAllRead = () => {
    if (!currentUser) return;
    const socket = getSocket();
    
    // تحديث متفائل فورياً
    markAllNotificationsRead();
    
    // تأكيد في الخلفية
    socket.emit("notifications:mark_all_read");
  };

  // تحديد تلقائي كمقروء عند فتح النافذة
  useEffect(() => {
    if (notificationUnreadCount > 0) {
      handleMarkAllRead();
    }
  }, []);

  const handleMarkRead = (id: string) => {
    if (!currentUser) return;
    const socket = getSocket();
    
    // تحديث متفائل فورياً
    markNotificationRead(id);
    
    // تأكيد في الخلفية
    socket.emit("notifications:mark_read", { notificationId: id });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="animate-spin text-primary" size={20} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full rtl">
      {(compact || true) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black text-foreground">التنبيهات</h3>
            {notificationUnreadCount > 0 && (
              <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black">{notificationUnreadCount}</Badge>
            )}
          </div>
          {notificationUnreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-primary hover:text-primary/80 flex items-center gap-1">
              <CheckCheck size={12} /> تحديد الكل مقروء
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="text-center py-12">
            <Bell size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-400">لا توجد تنبيهات</p>
            <p className="text-[10px] text-slate-400 mt-1">ستظهر هنا تفاعلات المستخدمين معك</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {notifications.map((n) => {
              const isRead = n.readAt != null || n.isRead;
              
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 p-3 transition-all cursor-pointer ${
                    !isRead ? "bg-blue-50/40 dark:bg-blue-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                  onClick={() => { if (!isRead) handleMarkRead(n.id); }}
                >
                  <Avatar className="w-11 h-11 rounded-xl shrink-0">
                    <AvatarImage src={onlineUsers.find(u => String(u.id) === String(n.actorId))?.avatar || n.actor?.avatar || "/pic.png"} />
                    <AvatarFallback className="rounded-xl text-[10px]">{n.actor?.name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs truncate" style={(() => {
                        const actorId = n.actorId || n.actor?.id;
                        if (!actorId) return undefined;
                        const u = onlineUsers.find(o => String(o.id) === String(actorId));
                        const resolvedColor = u?.nameColor || (n.actor as any)?.nameColor || "";
                        return resolvedColor && resolvedColor !== "#000000" ? { color: resolvedColor } : undefined;
                      })()}>{n.actor?.name}</span>
                      <NotificationIcon type={n.type} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{getNotificationText(n)}</p>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5">{formatTime(n.createdAt)}</p>
                  </div>
                  {!isRead && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsList;
