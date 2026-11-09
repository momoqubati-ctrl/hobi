"use client";

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, ShieldAlert } from 'lucide-react';
import { LEGACY_CP_SECTIONS, getSectionTranslation, getFieldLanguage } from './constants';
import { canViewAdminSection } from './powers/permissionDefs';

// Import Sections
import OverviewSection from './sections/OverviewSection';
import UsersSection from './sections/UsersSection';
import RoomsSection from './sections/RoomsSection';
import PermissionsMatrix from './powers/PermissionsMatrix';
import EventsSection from './sections/EventsSection';
import SettingsSection from './sections/SettingsSection';
import DatabaseSection from './sections/DatabaseSection';
import BotsAdminSection from './sections/BotsAdminSection';
import FiltersAdminSection from './sections/FiltersAdminSection';
import StickersSection from './sections/StickersSection';
import SwiperBannersSection from './sections/SwiperBannersSection';
import ProfileFramesSection from './sections/ProfileFramesSection';
import MemberCardThemesSection from './sections/MemberCardThemesSection';
import RoomBadgesSection from './sections/RoomBadgesSection';
import IconsSection from './sections/IconsSection';
import GiftsSection from './sections/GiftsSection';
import AnimatedFacesSection from './sections/AnimatedFacesSection';
import LegacyCpSection from './sections/LegacyCpSection';
import VoiceProviderSection from './sections/VoiceProviderSection';
import GiftCommissionSection from './sections/GiftCommissionSection';
import WalletAgentsSection from './sections/WalletAgentsSection';

// New Modular Sections
import ModerationSection from './moderation/ModerationSection';
import BansSection from './bans/BansSection';
import AuditLogsSection from './audit/AuditLogsSection';
import AccessLogsSection from './access-logs/AccessLogsSection';

interface AdminDashboardProps {
  section: string;
  permissions: string[];
}

const AdminDashboard = ({ section, permissions }: AdminDashboardProps) => {
  const [langKey, setLangKey] = useState(0);
  const rawSection = LEGACY_CP_SECTIONS[section];

  useEffect(() => {
    const handleLangChange = () => {
      setLangKey((k) => k + 1);
    };
    window.addEventListener("admin_lang_changed", handleLangChange);
    window.addEventListener("storage", handleLangChange);
    return () => {
      window.removeEventListener("admin_lang_changed", handleLangChange);
      window.removeEventListener("storage", handleLangChange);
    };
  }, []);

  const legacySection = rawSection ? (() => {
    const translated = getSectionTranslation(section);
    return {
      ...rawSection,
      title: translated?.title || rawSection.title,
      description: translated?.description || rawSection.description,
    };
  })() : undefined;
  
  const renderSection = () => {
    switch (section) {
      case "overview":
        return <OverviewSection />;
      case "users":
        return <UsersSection />;
      case "rooms":
        return <RoomsSection />;
      case "roles":
        return <PermissionsMatrix />;
      case "events":
        return <ModerationSection />;
      case "actions":
        return <AccessLogsSection />; // تم ربط "السجل" (الحالات) بالنظام الجديد
      case "bans":
        return <BansSection />;
      case "settings":
        return <SettingsSection />;
      case "database":
        return <DatabaseSection />;
      case "bots":
        return <BotsAdminSection />;
      case "fltr":
        return <FiltersAdminSection />;
      case "stickers":
        return <StickersSection />;
      case "swiperbanners":
        return <SwiperBannersSection permissions={permissions} />;
      case "profileframes":
        return <ProfileFramesSection permissions={permissions} />;
      case "membercardtheme":
        return <MemberCardThemesSection permissions={permissions} />;
      case "roomBadges":
        return <RoomBadgesSection />;
      case "icons":
        return <IconsSection permissions={permissions} />;
      case "gifts":
        return <GiftsSection />;
      case "giftcommission":
        return <GiftCommissionSection permissions={permissions} />;
      case "agentwallets":
        return <WalletAgentsSection permissions={permissions} />;
      case "animatedfaces":
        return <AnimatedFacesSection />;
      case "micprovidercp":
        return <VoiceProviderSection permissions={permissions} />;
      case "hostin":
        return <AuditLogsSection />;
      default:
        if (legacySection) {
          return <LegacyCpSection config={legacySection} />;
        }
        return (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-border">
            <SettingsIcon size={48} className="mb-4 opacity-20" />
            <h2 className="text-xl font-bold mb-2">هذا القسم قيد التطوير</h2>
            <p className="text-sm">سيتم ربط هذا القسم بالبيانات الحقيقية قريباً.</p>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 rtl bg-slate-50/50 dark:bg-slate-950/50">
      <div className="max-w-7xl mx-auto space-y-6">
        {canViewAdminSection(permissions, section) ? renderSection() : (
          <div className="rounded-3xl border border-dashed border-border bg-white py-20 text-center text-muted-foreground dark:bg-slate-900">
            <ShieldAlert className="mx-auto mb-4 opacity-30" size={40} />
            <h2 className="mb-2 text-xl font-bold">لا تملك صلاحية عرض هذا القسم</h2>
            <p className="text-sm">اطلب من مالك الموقع تفعيل صلاحية قراءة هذا القسم.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;