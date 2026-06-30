export interface ResourceDef {
  key: string;
  label: string;
  icon?: string;
}

export interface PermissionGroup {
  label: string;
  resources: ResourceDef[];
}

/** الموارد الأساسية - لها read / edit / delete / all */
export const BASIC_GROUPS: PermissionGroup[] = [
  {
    label: "الإشراف على الشات",
    resources: [
      { key: "kick", label: "طرد الأعضاء" },
      { key: "ban", label: "حظر الأعضاء" },
      { key: "meiut", label: "كتم الأعضاء" },
      { key: "delmsg", label: "حذف الرسائل" },
      { key: "delbc", label: "حذف منشورات الحائط" },
      { key: "delpic", label: "حذف الصور والغلاف" },
      { key: "alert", label: "إرسال تنبيهات" },
      { key: "forcepm", label: "فتح خاص إجباري" },
      { key: "history", label: "سجل الرسائل" },
    ],
  },
  {
    label: "الأعضاء والرتب",
    resources: [
      { key: "edituser", label: "تعديل بيانات العضو" },
      { key: "setpower", label: "تعيين الرتب" },
      { key: "stealth", label: "وضع التخفي" },
      { key: "mynick", label: "تلوين الاسم الشخصي" },
      { key: "unick", label: "تغيير أسماء الأعضاء" },
      { key: "loveu", label: "إعطاء إعجابات" },
      { key: "ulike", label: "إعجابات غير محدودة" },
      { key: "status_color", label: "تغيير لون الحالة" },
      { key: "reveal", label: "كشف الهوية" },
      { key: "profile_viewers", label: "مشاهدة البروفايل" },
    ],
  },
  {
    label: "الغرف والتواصل",
    resources: [
      { key: "roomowner", label: "مالك الغرفة" },
      { key: "createroom", label: "إنشاء الغرف" },
      { key: "rooms", label: "إدارة الغرف" },
      { key: "publicmsg", label: "رسائل عامة (إعلان)" },
      { key: "publicmsghide", label: "رسائل عامة مخفية" },
      { key: "bot", label: "إدارة البوتات" },
      { key: "grupes", label: "إدارة المجموعات" },
    ],
  },
  {
    label: "الإدارة المتقدمة",
    resources: [
      { key: "flter", label: "إدارة الفلتر" },
      { key: "shrt", label: "إدارة الاختصارات" },
      { key: "subs", label: "إدارة الاشتراكات" },
      { key: "upgrades", label: "إدارة الترقيات" },
      { key: "msgs", label: "إدارة الرسائل الترحيبية" },
      { key: "micprovideredit", label: "تعديل مزود المايكات" },
      { key: "evaluationpoints", label: "إدارة نقاط التفاعل" },
      { key: "bootedit", label: "إدارة الأعضاء الوهميين" },
      { key: "gift", label: "إرسال هدايا" },
      { key: "filter_alerts", label: "تنبيهات الفلتر" },
    ],
  },
  {
    label: "النظام والإعدادات",
    resources: [
      { key: "moderation_monitor", label: "مراقبة التعديل" },
      { key: "realtime_admin", label: "إدارة فورية" },
      { key: "analytics_access", label: "دخول الإحصائيات" },
      { key: "audit_logs", label: "سجلات المراجعة" },
      { key: "manage_notifications", label: "إدارة الإشعارات" },
      { key: "manage_wallets", label: "إدارة المحافظ" },
      { key: "manage_domains", label: "إدارة النطاقات" },
      { key: "anti_ddos", label: "حماية DDoS" },
      { key: "maintenance_mode", label: "وضع الصيانة" },
    ],
  },
  {
    label: "لوحة التحكم - تبويبات",
    resources: [
      { key: "cp", label: "دخول لوحة التحكم" },
      { key: "admin_overview", label: "داش بورد" },
      { key: "admin_events", label: "السجل" },
      { key: "admin_actions", label: "الحالات" },
      { key: "admin_users", label: "الأعضاء" },
      { key: "admin_bans", label: "الحظر" },
      { key: "admin_roles", label: "الصلاحيات" },
      { key: "admin_fltr", label: "فلتر" },
      { key: "admin_rooms", label: "الغرف" },
      { key: "admin_stickers", label: "الملصقات" },
      { key: "admin_swiperbanners", label: "بنرات السوابر" },
      { key: "admin_profileframes", label: "اطارات صورة البروفايل" },
      { key: "admin_membercardtheme", label: "ثيم بطاقة العضو" },
      { key: "admin_icons", label: "ايقونات" },
      { key: "admin_animatedfaces", label: "فيسات متحركة" },
      { key: "admin_roomBadges", label: "شارات الغرف" },
      { key: "admin_siteBadges", label: "شارات الموقع" },
      { key: "admin_shrt", label: "الإختصارات" },
      { key: "admin_msgs", label: "الرسائل" },
      { key: "admin_bots", label: "الوهمي الناطق" },
      { key: "admin_subs", label: "الإشتراكات" },
      { key: "admin_giftsgit", label: "هدايا git" },
      { key: "admin_agentwallets", label: "شحن الوكلاء" },
      { key: "admin_evaluationpoints", label: "احتساب النقاط" },
      { key: "admin_settings", label: "إدارة الموقع" },
      { key: "admin_database", label: "قاعدة البيانات" },
      { key: "admin_micprovidercp", label: "مزود المايكات" },
      { key: "admin_ddosguardcp", label: "حماية الدوز" },
      { key: "admin_hostin", label: "الإضافات" },
      { key: "admin_hostcleanup", label: "صيانة الإضافات" },
      { key: "admin_hostcontrols", label: "مفاتيح الإضافات" },
      { key: "admin_hostsettings", label: "روابط الإضافات" },
      { key: "admin_hostdomains", label: "دومينات الإضافات" },
    ],
  },
];

/** الموارد البصرية - لها use فقط */
export const VISUAL_RESOURCES: ResourceDef[] = [
  { key: "uploadgif", label: "رفع صورة متحركة" },
  { key: "gradientname", label: "تدرج الاسم" },
  { key: "custombg", label: "لون بطاقة العضو" },
  { key: "chattem", label: "صورة خلفية البطاقة" },
  { key: "frame", label: "إطار الصورة" },
  { key: "banner", label: "بنر بدلاً من الاسم" },
  { key: "icon", label: "إرسال ايقونات بجانب الاسم" },
  { key: "gifticon", label: "أيقونات الهدايا" },
];

/** ترجمة رؤوس الأعمدة (Actions) */
export const ACTION_LABELS: Record<string, string> = {
  read: "قراءة",
  edit: "تعديل",
  delete: "حذف",
  all: "الكل",
  use: "استخدام",
};

/** Returns the list of action suffixes for a given resource key */
export function getActionsForResource(key: string): string[] {
  // Visual resources have only "use"
  if (VISUAL_RESOURCES.some(r => r.key === key)) {
    return ["use"];
  }
  return ["read", "edit", "delete", "all"];
}
