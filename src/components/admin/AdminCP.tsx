"use client";

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Users, MessageSquare, Settings, BarChart3, Lock, Globe, Activity,
  Ban, ShieldAlert, Cpu, Mic, Key, Link as LinkIcon, Database, HardDrive, ListFilter,
  BadgeAlert, Award, Gift, Wallet, Calculator, Wrench, RefreshCw, Zap, Sticker, Smile,
  Image
} from 'lucide-react';
import { getMenuLabel, getGroupLabel, getFieldLanguage, setFieldLanguage } from './constants';

interface AdminCPProps {
  activeSection: string;
  onChangeSection: (section: string) => void;
}

const AdminCP = ({ activeSection, onChangeSection }: AdminCPProps) => {
  const [lang, setLang] = useState<"ar" | "en">(getFieldLanguage);
  const [, setTick] = useState(0);

  const toggleLang = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    setFieldLanguage(next);
    setTick((t) => t + 1);
  };

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

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1 pb-10 scrollbar-thin">
        <NavGroup title={getGroupLabel("g_main")}>
          <AdminAction id="overview" icon={<BarChart3 size={16} />} label={getMenuLabel("overview")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="events" icon={<Activity size={16} />} label={getMenuLabel("events")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="actions" icon={<Zap size={16} />} label={getMenuLabel("actions")} activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title={getGroupLabel("g_members")}>
          <AdminAction id="users" icon={<Users size={16} />} label={getMenuLabel("users")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="bans" icon={<Ban size={16} />} label={getMenuLabel("bans")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="roles" icon={<Lock size={16} />} label={getMenuLabel("roles")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="fltr" icon={<ListFilter size={16} />} label={getMenuLabel("fltr")} activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title={getGroupLabel("g_rooms")}>
          <AdminAction id="rooms" icon={<MessageSquare size={16} />} label={getMenuLabel("rooms")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="stickers" icon={<Sticker size={16} />} label={getMenuLabel("stickers")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="swiperbanners" icon={<Image size={16} />} label={getMenuLabel("swiperbanners")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="profileframes" icon={<Image size={16} />} label={getMenuLabel("profileframes")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="membercardtheme" icon={<Image size={16} />} label={getMenuLabel("membercardtheme")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="icons" icon={<Image size={16} />} label={getMenuLabel("icons")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="gifts" icon={<Gift size={16} />} label={getMenuLabel("gifts")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="animatedfaces" icon={<Smile size={16} />} label={getMenuLabel("animatedfaces")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="roomBadges" icon={<BadgeAlert size={16} />} label={getMenuLabel("roomBadges")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="siteBadges" icon={<Award size={16} />} label={getMenuLabel("siteBadges")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="shrt" icon={<MessageSquare size={16} />} label={getMenuLabel("shrt")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="msgs" icon={<MessageSquare size={16} />} label={getMenuLabel("msgs")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="bots" icon={<Cpu size={16} />} label={getMenuLabel("bots")} activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title={getGroupLabel("g_finance")}>
          <AdminAction id="subs" icon={<Award size={16} />} label={getMenuLabel("subs")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="giftsgit" icon={<Gift size={16} />} label={getMenuLabel("giftsgit")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="agentwallets" icon={<Wallet size={16} />} label={getMenuLabel("agentwallets")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="evaluationpoints" icon={<Calculator size={16} />} label={getMenuLabel("evaluationpoints")} activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title={getGroupLabel("g_system")}>
          <AdminAction id="settings" icon={<Settings size={16} />} label={getMenuLabel("settings")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="database" icon={<Database size={16} />} label={getMenuLabel("database")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="micprovidercp" icon={<Mic size={16} />} label={getMenuLabel("micprovidercp")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="ddosguardcp" icon={<ShieldAlert size={16} />} label={getMenuLabel("ddosguardcp")} activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title={getGroupLabel("g_plugins")}>
          <AdminAction id="hostin" icon={<HardDrive size={16} />} label={getMenuLabel("hostin")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostcleanup" icon={<Wrench size={16} />} label={getMenuLabel("hostcleanup")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostcontrols" icon={<Key size={16} />} label={getMenuLabel("hostcontrols")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostsettings" icon={<LinkIcon size={16} />} label={getMenuLabel("hostsettings")} activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostdomains" icon={<Database size={16} />} label={getMenuLabel("hostdomains")} activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>
      </div>
    </div>
  );
};

const NavGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="mb-4">
    <h4 className="text-[10px] font-bold text-muted-foreground px-2 mb-1 uppercase tracking-wider">{title}</h4>
    <div className="space-y-0.5">
      {children}
    </div>
  </div>
);

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
