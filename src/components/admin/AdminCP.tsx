"use client";

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Users, MessageSquare, Settings, BarChart3, Lock, Globe, Activity,
  Ban, ShieldAlert, Cpu, Mic, Key, Link as LinkIcon, Database, HardDrive, ListFilter,
  BadgeAlert, Award, Gift, Wallet, Calculator, Wrench, RefreshCw, Zap, Sticker, Smile,
  Image
} from 'lucide-react';
import { getMenuLabel, getGroupLabel, getFieldLanguage, setFieldLanguage } from './constants';
import { ADMIN_SECTION_PERMISSION_BY_ID, canViewAdminSection } from './powers/permissionDefs';

interface AdminCPProps {
  permissions: string[];
  activeSection: string;
  onChangeSection: (section: string) => void;
}

const AdminCP = ({ permissions, activeSection, onChangeSection }: AdminCPProps) => {
  const [lang, setLang] = useState<"ar" | "en">(getFieldLanguage);
  const [, setTick] = useState(0);

  const toggleLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    setFieldLanguage(next);
    setTick((t) => t + 1);
  };

  const renderAction = (id: string, icon: React.ReactNode, label: string) =>
    canViewAdminSection(permissions, id)
      ? <AdminAction id={id} icon={icon} label={label} activeSection={activeSection} onClick={onChangeSection} />
      : null;
  const hasSectionAccess = Object.keys(ADMIN_SECTION_PERMISSION_BY_ID)
    .some(section => canViewAdminSection(permissions, section));

  return (
    <div className="p-4 space-y-6 rtl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <ShieldCheck className="text-primary" size={24} />
          </div>
          <div>
            <h3 className="font-bold text-foreground">{getMenuLabel("cpanel")}</h3>
            <p className="text-[10px] text-muted-foreground font-medium">{lang === "ar" ? "إدارة النظام والصلاحيات" : "System & Permissions Management"}</p>
          </div>
        </div>
        <button
          onClick={toggleLang}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-muted hover:bg-muted/80 transition"
          title={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
        >
          <Globe size={12} />
          {lang === "ar" ? "EN" : "عربي"}
        </button>
      </div>

      {!hasSectionAccess && (
        <p role="status" className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          لا توجد صلاحية قراءة لأي قسم في لوحة التحكم.
        </p>
      )}

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1 pb-10 scrollbar-thin">
        <NavGroup title={getGroupLabel("g_main")}>
          {renderAction("overview", <BarChart3 size={16} />, getMenuLabel("overview"))}
          {renderAction("events", <Activity size={16} />, getMenuLabel("events"))}
          {renderAction("actions", <Zap size={16} />, getMenuLabel("actions"))}
        </NavGroup>

        <NavGroup title={getGroupLabel("g_members")}>
          {renderAction("users", <Users size={16} />, getMenuLabel("users"))}
          {renderAction("bans", <Ban size={16} />, getMenuLabel("bans"))}
          {renderAction("roles", <Lock size={16} />, getMenuLabel("roles"))}
          {renderAction("fltr", <ListFilter size={16} />, getMenuLabel("fltr"))}
        </NavGroup>

        <NavGroup title={getGroupLabel("g_rooms")}>
          {renderAction("rooms", <MessageSquare size={16} />, getMenuLabel("rooms"))}
          {renderAction("stickers", <Sticker size={16} />, getMenuLabel("stickers"))}
          {renderAction("swiperbanners", <Image size={16} />, getMenuLabel("swiperbanners"))}
          {renderAction("profileframes", <Image size={16} />, getMenuLabel("profileframes"))}
          {renderAction("membercardtheme", <Image size={16} />, getMenuLabel("membercardtheme"))}
          {renderAction("icons", <Image size={16} />, getMenuLabel("icons"))}
          {renderAction("gifts", <Gift size={16} />, getMenuLabel("gifts"))}
          {renderAction("animatedfaces", <Smile size={16} />, getMenuLabel("animatedfaces"))}
          {renderAction("roomBadges", <BadgeAlert size={16} />, getMenuLabel("roomBadges"))}
          {renderAction("siteBadges", <Award size={16} />, getMenuLabel("siteBadges"))}
          {renderAction("shrt", <MessageSquare size={16} />, getMenuLabel("shrt"))}
          {renderAction("msgs", <MessageSquare size={16} />, getMenuLabel("msgs"))}
          {renderAction("bots", <Cpu size={16} />, getMenuLabel("bots"))}
        </NavGroup>

        <NavGroup title={getGroupLabel("g_finance")}>
          {renderAction("subs", <Award size={16} />, getMenuLabel("subs"))}
          {renderAction("giftsgit", <Gift size={16} />, getMenuLabel("giftsgit"))}
          {renderAction("agentwallets", <Wallet size={16} />, getMenuLabel("agentwallets"))}
          {renderAction("giftcommission", <Calculator size={16} />, getMenuLabel("giftcommission"))}
          {renderAction("evaluationpoints", <Calculator size={16} />, getMenuLabel("evaluationpoints"))}
        </NavGroup>

        <NavGroup title={getGroupLabel("g_system")}>
          {renderAction("settings", <Settings size={16} />, getMenuLabel("settings"))}
          {renderAction("database", <Database size={16} />, getMenuLabel("database"))}
          {renderAction("micprovidercp", <Mic size={16} />, getMenuLabel("micprovidercp"))}
          {renderAction("ddosguardcp", <ShieldAlert size={16} />, getMenuLabel("ddosguardcp"))}
        </NavGroup>

        <NavGroup title={getGroupLabel("g_plugins")}>
          {renderAction("hostin", <HardDrive size={16} />, getMenuLabel("hostin"))}
          {renderAction("hostcleanup", <Wrench size={16} />, getMenuLabel("hostcleanup"))}
          {renderAction("hostcontrols", <Key size={16} />, getMenuLabel("hostcontrols"))}
          {renderAction("hostsettings", <LinkIcon size={16} />, getMenuLabel("hostsettings"))}
          {renderAction("hostdomains", <Database size={16} />, getMenuLabel("hostdomains"))}
        </NavGroup>
      </div>
    </div>
  );
};

const NavGroup = ({ title, children }: { title: string, children: React.ReactNode }) => {
  const visibleChildren = React.Children.toArray(children);
  if (visibleChildren.length === 0) return null;

  return (
    <div className="mb-4">
      <h4 className="text-[10px] font-bold text-muted-foreground px-2 mb-1 uppercase tracking-wider">{title}</h4>
      <div className="space-y-0.5">
        {visibleChildren}
      </div>
    </div>
  );
};

const AdminAction = ({ id, icon, label, activeSection, onClick }: { id: string, icon: React.ReactNode; label: string, activeSection: string, onClick: (id: string) => void }) => {
  const isActive = activeSection === id;
  return (
    <button 
      onClick={() => onClick(id)}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all group ${isActive ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`${isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'} transition-colors`}>
          {icon}
        </div>
        <span className="text-[13px] font-bold">{label}</span>
      </div>
    </button>
  );
};

export default AdminCP;
