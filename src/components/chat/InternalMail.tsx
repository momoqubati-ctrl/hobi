"use client";

import React, { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, Search, Send, Trash2, Loader2, Inbox, ArrowUpRight, X, ChevronRight, Reply } from 'lucide-react';
import { getSocket } from "@/lib/socket";
import { useRealtimeStore } from "@/lib/realtime-store";
import { optimisticSendMail } from "@/lib/optimistic-actions";

interface MailItem {
  id: string;
  senderId: string;
  recipientId: string;
  subject?: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  senderName?: string;
  senderAvatar?: string;
  recipientName?: string;
  recipientAvatar?: string;
  isOptimistic?: boolean;
}

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch { return null; }
};

const InternalMail = () => {
  const currentUser = getStoredUser();
  const [tab, setTab] = useState<"inbox" | "outbox" | "compose">("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMail, setSelectedMail] = useState<MailItem | null>(null);
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; avatar: string } | null>(null);

  const {
    inbox,
    outbox,
    mailUnreadCount: unreadCount,
    isLoadingMail: loading,
    markMailRead,
    deleteMail,
    setMail,
  } = useRealtimeStore();

  const handleMarkRead = (mailId: string) => {
    if (!currentUser) return;
    const socket = getSocket();
    
    // تحديث متفائل فوراً
    markMailRead(mailId);
    
    // تأكيد في الخلفية
    socket.emit("mail:mark_read", { mailId });
  };

  const handleDelete = (mailId: string, boxType: 'inbox' | 'outbox') => {
    if (!currentUser) return;
    const socket = getSocket();
    
    // تحديث متفائل فوراً
    deleteMail(mailId, boxType);
    if (selectedMail?.id === mailId) {
      setSelectedMail(null);
    }
    
    // تأكيد في الخلفية
    socket.emit("mail:delete", { mailId });
  };

  const handleSend = async (recipientId: string, body: string) => {
    if (!currentUser) return { success: false, message: "غير مسجل الدخول" };
    try {
      const mail = await optimisticSendMail(recipientId, "", body, currentUser);
      return { success: true, mail };
    } catch (err: any) {
      return { success: false, message: err.message || "فشل إرسال البريد" };
    }
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

  const currentList = tab === "inbox" ? inbox : outbox;

  if (selectedMail) {
    const isIncoming = selectedMail.recipientId === currentUser?.id;
    const name = isIncoming ? selectedMail.senderName : selectedMail.recipientName;
    const avatar = isIncoming ? selectedMail.senderAvatar : selectedMail.recipientAvatar;
    const isRead = selectedMail.readAt != null;

    return (
      <div className="flex flex-col h-full rtl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <button
            onClick={() => {
              setSelectedMail(null);
              if (isIncoming && !isRead) {
                handleMarkRead(selectedMail.id);
              }
            }}
            className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80"
          >
            <ChevronRight size={16} />
            عودة
          </button>
          <button
            onClick={() => handleDelete(selectedMail.id, isIncoming ? 'inbox' : 'outbox')}
            className="text-slate-300 hover:text-red-500 p-1"
            disabled={selectedMail.isOptimistic}
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => {
              setReplyTo({
                id: isIncoming ? selectedMail.senderId : selectedMail.recipientId,
                name: name || "",
                avatar: avatar || "/pic.png",
              });
              setSelectedMail(null);
              setComposing(true);
            }}
            className="text-slate-300 hover:text-primary p-1"
          >
            <Reply size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 rounded-xl">
              <AvatarImage src={avatar || "/pic.png"} />
              <AvatarFallback className="rounded-xl">{(name || "?")[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-bold text-sm">{name}</p>
              <p className="text-[10px] text-muted-foreground">{formatTime(selectedMail.createdAt)}</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedMail.body}</p>
        </div>
      </div>
    );
  }

  if (composing) {
    return (
      <ComposeForm
        preselectedUser={replyTo}
        onSend={async (recipientId, body) => {
          const result = await handleSend(recipientId, body);
          if (result.success) {
            setComposing(false);
            setReplyTo(null);
          }
          return result;
        }}
        onCancel={() => { setComposing(false); setReplyTo(null); }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full rtl">
      {/* Tabs */}
      <div className="flex border-b border-border/50">
        {([{ id: "inbox", label: "الوارد", icon: Inbox },
           { id: "outbox", label: "المرسل", icon: ArrowUpRight },
           { id: "compose", label: "إرسال", icon: Send }] as const).map(t => {
          const isActive = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); if (t.id === "compose") setComposing(true); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition-all ${
                isActive ? "text-primary border-b-2 border-primary" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Icon size={14} />
              {t.label}
              {t.id === "inbox" && unreadCount > 0 && (
                <Badge className="bg-primary text-white text-[8px] min-w-[16px] h-4 px-1">{unreadCount}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute right-3 top-2.5 text-muted-foreground" size={16} />
          <Input
            placeholder={tab === "inbox" ? "بحث في البريد الوارد..." : "بحث في البريد المرسل..."}
            className="h-9 bg-slate-100 dark:bg-slate-800 border-none pr-10 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            dir="rtl"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : (
          <div className="space-y-0.5">
            {currentList
              .filter(m => m.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (m.senderName || m.recipientName || "").toLowerCase().includes(searchQuery.toLowerCase()))
              .map((mail) => {
                const isIncoming = mail.recipientId === currentUser?.id;
                const name = isIncoming ? mail.senderName : mail.recipientName;
                const avatar = isIncoming ? mail.senderAvatar : mail.recipientAvatar;
                const isUnread = isIncoming && !mail.readAt;

                return (
                  <div
                    key={mail.id}
                    className={`flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-all ${
                      isUnread ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                    } ${mail.isOptimistic ? "opacity-70" : ""}`}
                    onClick={() => setSelectedMail(mail)}
                  >
                    <Avatar className="w-9 h-9 rounded-xl shrink-0">
                      <AvatarImage src={avatar || "/pic.png"} />
                      <AvatarFallback className="rounded-xl">{(name || "?")[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className={`text-xs truncate ${isUnread ? "font-black text-foreground" : "font-bold text-slate-600 dark:text-slate-400"}`}>
                          {name}
                        </h4>
                        <span className="text-[9px] text-muted-foreground shrink-0">{formatTime(mail.createdAt)}</span>
                      </div>
                      <p className={`text-[11px] truncate mt-0.5 ${isUnread ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                        {mail.body}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setReplyTo({
                          id: isIncoming ? mail.senderId : mail.recipientId,
                          name: name || "",
                          avatar: avatar || "/pic.png",
                        });
                        setComposing(true);
                      }}
                      className="text-slate-300 hover:text-primary shrink-0"
                      disabled={mail.isOptimistic}
                    >
                      <Reply size={13} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(mail.id, isIncoming ? 'inbox' : 'outbox'); }}
                      className="text-slate-300 hover:text-red-500 shrink-0"
                      disabled={mail.isOptimistic}
                    >
                      <Trash2 size={13} />
                    </button>
                    </div>
                  </div>
                );
              })}
            {currentList.length === 0 && (
              <div className="text-center py-12">
                <Mail size={36} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm font-bold text-slate-400">
                  {tab === "inbox" ? "لا توجد رسائل" : "لم ترسل أي رسائل بعد"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ComposeForm = ({ preselectedUser, onSend, onCancel }: {
  preselectedUser?: { id: string; name: string; avatar: string } | null;
  onSend: (recipientId: string, body: string) => Promise<any>;
  onCancel: () => void;
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(
    preselectedUser ? { id: preselectedUser.id, username: preselectedUser.name, topic: preselectedUser.name, pic: preselectedUser.avatar } : null
  );
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (searchTerm.length < 2) { setUsers([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/user/search?q=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();
        if (data.success) setUsers(data.users || []);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const handleSubmit = async () => {
    if (!selectedUser) { setError("اختر مستلم"); return; }
    if (!body.trim()) { setError("أدخل نص الرسالة"); return; }
    setSending(true);
    setError("");
    const result = await onSend(selectedUser.id, body);
    if (!result.success) setError(result.message || "فشل الإرسال");
    setSending(false);
  };

  return (
    <div className="flex flex-col h-full rtl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h3 className="text-xs font-black">رسالة جديدة</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-1">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!selectedUser ? (
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground">البحث عن مستلم</label>
            <Input
              placeholder="اسم المستخدم..."
              className="h-9 text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              dir="rtl"
            />
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {users.map((u: any) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  onClick={() => setSelectedUser(u)}
                >
                  <Avatar className="w-8 h-8 rounded-lg">
                    <AvatarImage src={u.pic || "/pic.png"} />
                    <AvatarFallback className="rounded-lg">{(u.username || "?")[0]}</AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-bold">{u.topic || u.username}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-100 dark:bg-slate-800">
            <Avatar className="w-8 h-8 rounded-lg">
              <AvatarImage src={selectedUser.pic || "/pic.png"} />
              <AvatarFallback className="rounded-lg">{(selectedUser.username || "?")[0]}</AvatarFallback>
            </Avatar>
            <span className="text-xs font-bold flex-1">{selectedUser.topic || selectedUser.username}</span>
            <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-red-500">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-bold text-muted-foreground">نص الرسالة</label>
          <textarea
            className="w-full h-32 rounded-xl border border-input bg-transparent p-3 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="اكتب رسالتك هنا..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            dir="rtl"
          />
        </div>

        {error && <p className="text-xs text-red-500 font-bold">{error}</p>}

        <Button
          onClick={handleSubmit}
          disabled={sending}
          className="w-full rounded-2xl font-black h-11"
        >
          {sending ? <Loader2 className="animate-spin" size={18} /> : <><Send size={16} /> إرسال</>}
        </Button>
      </div>
    </div>
  );
};

export default InternalMail;
