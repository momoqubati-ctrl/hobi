"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Heart, 
  Bell, 
  UserPlus, 
  MessageCircle, 
  Gift, 
  Shield, 
  Crown, 
  MapPin,
  Settings,
  Ban,
  Trash2,
  MoveRight,
  Edit3
} from 'lucide-react';
import { getCountryFlagSrc, getCountryName } from "@/lib/countries";

interface ProfileModalProps {
  user: any;
  isOpen: boolean;
  onClose: () => void;
  isAdmin?: boolean;
}

const ProfileModal = ({ user, isOpen, onClose, isAdmin = true }: ProfileModalProps) => {
  if (!user) return null;

  const statusMsg = typeof user.statusMsg === "string" && user.statusMsg.trim() ? user.statusMsg : user.profileMsg || "(عضو جديد)";
  const bannerUrl =
    typeof user.profileBannerUrl === "string" && user.profileBannerUrl.trim()
      ? user.profileBannerUrl
      : typeof user.profileCover === "string" && user.profileCover.trim()
        ? user.profileCover
        : "";
  const coverStyle =
    bannerUrl
      ? { backgroundImage: `url(${bannerUrl})` }
      : undefined;
  const avatarFrameStyle =
    typeof user.avatarFrameUrl === "string" && user.avatarFrameUrl.trim()
      ? { backgroundImage: `url(${user.avatarFrameUrl})` }
      : undefined;
  const profileAccentColor = typeof user.profileAccentColor === "string" && user.profileAccentColor.trim() ? user.profileAccentColor : "#2563EB";

  const handleModerationAction = (action: string) => {
    const socket = (window as any).__SOCKET__ || import("@/lib/socket").then(m => m.getSocket());
    import("@/lib/socket").then(m => {
      const s = m.getSocket();
      if (!s || !s.connected) {
        alert("غير متصل بالسيرفر");
        return;
      }
      const reason = prompt("السبب (اختياري):", "");
      if (reason !== null) {
        s.emit("moderation_action", {
          action,
          targetSocketId: user.socketId || user.id, // we might need socketId, but let's send id if socketId isn't there
          reason
        }, (res: any) => {
          if (!res.success) {
            alert(res.message || "فشل الإجراء");
          } else {
            alert(res.message || "تم بنجاح");
            onClose();
          }
        });
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-none rounded-3xl rtl">
        <DialogTitle className="sr-only">{user.name || "ملف العضو"}</DialogTitle>
        <DialogDescription className="sr-only">عرض تفاصيل البروفايل داخل الدردشة.</DialogDescription>
        {/* Cover & Avatar */}
        <div
          className="relative h-32 bg-gradient-to-r from-primary to-blue-600 bg-cover bg-center"
          style={coverStyle || { backgroundColor: profileAccentColor }}
        >
          <div className="absolute -bottom-12 right-6">
            <div
              className="relative rounded-full bg-cover bg-center p-1"
              style={avatarFrameStyle}
            >
              <Avatar className="w-24 h-24 border-4 border-white shadow-lg">
                <AvatarImage src={user.avatar || user.avatarUrl || "/pic.png"} />
                <AvatarFallback>{user.name[0]}</AvatarFallback>
              </Avatar>
              <span className="absolute bottom-1 right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white"></span>
            </div>
          </div>
        </div>

        <div className="pt-14 px-6 pb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-foreground" style={user.nameColor && user.nameColor !== "#000000" ? { color: user.nameColor } : undefined}>{user.name}</h2>
                {user.role === 'admin' && <Crown className="text-red-500" size={20} />}
                <Badge className="bg-blue-50 text-blue-600 border-blue-100">موثق</Badge>
                {user.giftIconUrl && <img loading="lazy" src={user.giftIconUrl} alt="gift" className="h-5 w-5 rounded object-cover" />}
                {user.profileIconUrl && <img loading="lazy" src={user.profileIconUrl} alt="profile icon" className="h-5 w-5 rounded object-cover" />}
              </div>
              <p className="text-muted-foreground text-sm flex items-center gap-1 mt-1">
                <MapPin size={14} />
                <img loading="lazy" src={getCountryFlagSrc(user.country)} alt={user.country} className="h-3 w-4 rounded-sm object-cover" />
                {getCountryName(user.country)} • {user.room}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="icon" variant="outline" className="rounded-full w-10 h-10">
                <Bell size={18} />
              </Button>
              <Button size="icon" variant="outline" className="rounded-full w-10 h-10">
                <UserPlus size={18} />
              </Button>
            </div>
          </div>

          <p className="text-sm mb-6 leading-relaxed" dir="rtl" style={user.statusFontColor && user.statusFontColor !== "#000000" ? { color: user.statusFontColor } : { color: "var(--muted-foreground)" }}>
            {statusMsg}
          </p>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6 bg-muted p-4 rounded-2xl">
            <StatItem label="إعجاب" value={user.rep || 0} />
            <StatItem label="نقاط" value={user.points || user.evaluation || 0} />
            <StatItem label="كوين" value={user.coins || 0} />
          </div>

          {(user.profileThemeId || user.messageBubbleStyle || user.nameEffectId) && (
            <div className="mb-6 rounded-2xl border border-border bg-card p-3 text-xs font-bold text-muted-foreground" dir="rtl">
              <div>الثيم: {user.profileThemeId || "افتراضي"}</div>
              <div>شكل الرسائل: {user.messageBubbleStyle || "افتراضي"}</div>
              <div>تأثير الاسم: {user.nameEffectId || "بدون"}</div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 mb-8">
            <Button className="flex-1 h-12 rounded-xl gap-2 font-bold">
              <MessageCircle size={18} /> خاص
            </Button>
            <Button variant="secondary" className="flex-1 h-12 rounded-xl gap-2 font-bold">
              <Gift size={18} /> إهداء
            </Button>
          </div>

          {/* Admin Tools */}
          {isAdmin && (
            <div className="border-t pt-6">
              <h4 className="text-xs font-bold text-muted-foreground mb-4 uppercase tracking-wider">أدوات الإدارة</h4>
              <div className="grid grid-cols-2 gap-2">
                <AdminButton icon={<Bell size={16} />} label="إرسال تنبيه" onClick={() => handleModerationAction("alert")} />
                <AdminButton icon={<MoveRight size={16} />} label="نقل لغرفة" />
                <AdminButton icon={<Shield size={16} />} label="تعديل الرتبة" />
                <AdminButton icon={<Ban size={16} />} label="حظر العضو" danger onClick={() => handleModerationAction("ban")} />
                <AdminButton icon={<Trash2 size={16} />} label="طرد عام" danger onClick={() => handleModerationAction("kick")} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const StatItem = ({ label, value }: any) => (
  <div className="text-center">
    <div className="text-lg font-bold text-foreground">{value}</div>
    <div className="text-[10px] text-muted-foreground font-medium uppercase">{label}</div>
  </div>
);

const AdminButton = ({ icon, label, danger, onClick }: any) => (
  <Button 
    variant="ghost" 
    size="sm" 
    onClick={onClick}
    className={`justify-start gap-2 h-10 rounded-xl text-xs font-bold ${danger ? 'text-red-500 hover:bg-red-50 hover:text-red-600' : 'text-muted-foreground hover:bg-slate-100'}`}
  >
    {icon}
    {label}
  </Button>
);

export default ProfileModal;
