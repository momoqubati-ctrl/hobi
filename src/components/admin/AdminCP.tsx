"use client";

import React from 'react';
import { 
  ShieldCheck, Users, MessageSquare, Settings, BarChart3, Lock, Globe, Activity,
  Ban, ShieldAlert, Cpu, Mic, Key, Link as LinkIcon, Database, HardDrive, ListFilter,
  BadgeAlert, Award, Gift, Wallet, Calculator, Wrench, RefreshCw, Zap, Sticker, Smile
} from 'lucide-react';

interface AdminCPProps {
  activeSection: string;
  onChangeSection: (section: string) => void;
}

const AdminCP = ({ activeSection, onChangeSection }: AdminCPProps) => {
  return (
    <div className="p-4 space-y-6 rtl">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-primary/10 rounded-xl">
          <ShieldCheck className="text-primary" size={24} />
        </div>
        <div>
          <h3 className="font-bold text-foreground">لوحة التحكم</h3>
          <p className="text-[10px] text-muted-foreground font-medium">إدارة النظام والصلاحيات</p>
        </div>
      </div>

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1 pb-10 scrollbar-thin">
        <NavGroup title="الرئيسية والإحصائيات">
          <AdminAction id="overview" icon={<BarChart3 size={16} />} label="داش بورد" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="events" icon={<Activity size={16} />} label="السجل" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="actions" icon={<Zap size={16} />} label="الحالات" activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title="الأعضاء والرقابة">
          <AdminAction id="users" icon={<Users size={16} />} label="الأعضاء" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="bans" icon={<Ban size={16} />} label="الحظر" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="roles" icon={<Lock size={16} />} label="الصلاحيات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="fltr" icon={<ListFilter size={16} />} label="فلتر" activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title="الغرف والتواصل">
          <AdminAction id="rooms" icon={<MessageSquare size={16} />} label="الغرف" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="stickers" icon={<Sticker size={16} />} label="الملصقات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="animatedfaces" icon={<Smile size={16} />} label="فيسات متحركة" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="roomBadges" icon={<BadgeAlert size={16} />} label="شارات الغرف" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="siteBadges" icon={<Award size={16} />} label="شارات الموقع" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="shrt" icon={<MessageSquare size={16} />} label="الإختصارات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="msgs" icon={<MessageSquare size={16} />} label="الرسائل" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="bots" icon={<Cpu size={16} />} label="الوهمي الناطق" activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title="المالية والهدايا">
          <AdminAction id="subs" icon={<Award size={16} />} label="الإشتراكات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="giftsgit" icon={<Gift size={16} />} label="هدايا git" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="agentwallets" icon={<Wallet size={16} />} label="شحن الوكلاء" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="evaluationpoints" icon={<Calculator size={16} />} label="احتساب النقاط" activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title="إدارة النظام">
          <AdminAction id="settings" icon={<Settings size={16} />} label="إداره الموقع" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="database" icon={<Database size={16} />} label="قاعدة البيانات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="micprovidercp" icon={<Mic size={16} />} label="تحديد مزود المايكات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="ddosguardcp" icon={<ShieldAlert size={16} />} label="حماية الدوز" activeSection={activeSection} onClick={onChangeSection} />
        </NavGroup>

        <NavGroup title="الإضافات (البلجنز)">
          <AdminAction id="hostin" icon={<HardDrive size={16} />} label="الاضافات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostcleanup" icon={<Wrench size={16} />} label="صيانة الاضافات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostcontrols" icon={<Key size={16} />} label="مفاتيح الاضافات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostsettings" icon={<LinkIcon size={16} />} label="روابط ونسخ الاضافات" activeSection={activeSection} onClick={onChangeSection} />
          <AdminAction id="hostdomains" icon={<Database size={16} />} label="دومينات وبيانات الاضافات" activeSection={activeSection} onClick={onChangeSection} />
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
