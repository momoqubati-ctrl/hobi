"use client";

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { LEGACY_CP_SECTIONS, getSectionTranslation, getFieldLanguage } from './constants';

// Import Sections
import OverviewSection from './sections/OverviewSection';
import UsersSection from './sections/UsersSection';
import RoomsSection from './sections/RoomsSection';
import RolesSection from './sections/RolesSection';
import EventsSection from './sections/EventsSection';
import SettingsSection from './sections/SettingsSection';
import DatabaseSection from './sections/DatabaseSection';
import BotsAdminSection from './sections/BotsAdminSection';
import FiltersAdminSection from './sections/FiltersAdminSection';
import StickersSection from './sections/StickersSection';
import AnimatedFacesSection from './sections/AnimatedFacesSection';
import LegacyCpSection from './sections/LegacyCpSection';

// New Modular Sections
import ModerationSection from './moderation/ModerationSection';
import BansSection from './bans/BansSection';
import AuditLogsSection from './audit/AuditLogsSection';
import AccessLogsSection from './access-logs/AccessLogsSection';

interface AdminDashboardProps {
  section: string;
}

const AdminDashboard = ({ section }: AdminDashboardProps) => {
  const [langKey, setLangKey] = useState(0);
  const rawSection = LEGACY_CP_SECTIONS[section];

  useEffect(() => {
    const interval = setInterval(() => {
      setLangKey((k) => k + 1);
    }, 1000);
    return () => clearInterval(interval);
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
        return <RolesSection />;
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
      case "animatedfaces":
        return <AnimatedFacesSection />;
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
        {renderSection()}
      </div>
    </div>
  );
};

export default AdminDashboard;