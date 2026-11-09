import { CHAT_FEATURE_GROUPS, CHAT_FEATURE_PERMISSION_KEYS } from "../../../lib/chatFeaturePermissions";

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
  ...CHAT_FEATURE_GROUPS.map((group) => ({
    label: group.label,
    resources: group.resources.map(({ key, label }) => ({ key, label })),
  })),
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
      { key: "lockedroom", label: "تجاوز حماية الغرف المقفلة" },
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
      { key: "admin_gifts", label: "الهدايا" },
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
      { key: "admin_giftcommission", label: "عمولة الهدايا" },
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
  if (VISUAL_RESOURCES.some(r => r.key === key) ||
      CHAT_FEATURE_PERMISSION_KEYS.some((permission) => permission.startsWith(`${key}.`))) {
    return ["use"];
  }
  return ["read", "edit", "delete", "all"];
}

export const ADMIN_SECTION_PERMISSION_BY_ID: Readonly<Record<string, string>> = {
  overview: "admin_overview",
  events: "admin_events",
  actions: "admin_actions",
  users: "admin_users",
  bans: "admin_bans",
  roles: "admin_roles",
  fltr: "admin_fltr",
  rooms: "admin_rooms",
  stickers: "admin_stickers",
  swiperbanners: "admin_swiperbanners",
  profileframes: "admin_profileframes",
  membercardtheme: "admin_membercardtheme",
  icons: "admin_icons",
  animatedfaces: "admin_animatedfaces",
  roomBadges: "admin_roomBadges",
  siteBadges: "admin_siteBadges",
  gifts: "admin_gifts",
  shrt: "admin_shrt",
  msgs: "admin_msgs",
  bots: "admin_bots",
  subs: "admin_subs",
  giftsgit: "admin_giftsgit",
  agentwallets: "admin_agentwallets",
  giftcommission: "admin_giftcommission",
  evaluationpoints: "admin_evaluationpoints",
  settings: "admin_settings",
  database: "admin_database",
  micprovidercp: "admin_micprovidercp",
  ddosguardcp: "admin_ddosguardcp",
  hostin: "admin_hostin",
  hostcleanup: "admin_hostcleanup",
  hostcontrols: "admin_hostcontrols",
  hostsettings: "admin_hostsettings",
  hostdomains: "admin_hostdomains",
};

/** Only actions with an active UI gate or server check can be edited. */
const IMPLEMENTED_PERMISSION_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(
    CHAT_FEATURE_PERMISSION_KEYS.map((permission) => [permission.slice(0, permission.lastIndexOf(".")), ["use"]]),
  ),
  cp: ["read", "all"],
  kick: ["read", "edit", "all"],
  ban: ["read", "edit", "all"],
  meiut: ["read", "edit", "all"],
  history: ["read", "edit", "all"],
  edituser: ["read", "edit", "all"],
  setpower: ["read", "edit", "all"],
  loveu: ["read", "edit", "all"],
  ulike: ["read", "edit", "all"],
  roomowner: ["read", "edit", "all"],
  createroom: ["edit"],
  rooms: ["read", "edit", "all"],
  lockedroom: ["read"],
  flter: ["read", "delete", "all"],
  micprovideredit: ["edit", "delete"],
  custombg: ["use"],
  chattem: ["use"],
  frame: ["use"],
  admin_overview: ["read"],
  admin_events: ["read"],
  admin_actions: ["read"],
  admin_users: ["read"],
  admin_bans: ["read"],
  admin_roles: ["read", "all"],
  admin_fltr: ["read"],
  admin_rooms: ["read", "edit", "all"],
  admin_stickers: ["read"],
  admin_gifts: ["read"],
  admin_swiperbanners: ["read", "edit", "delete", "all"],
  admin_profileframes: ["read", "edit", "delete", "all"],
  admin_membercardtheme: ["read", "edit", "delete", "all"],
  admin_icons: ["read", "edit", "delete", "all"],
  admin_animatedfaces: ["read"],
  admin_roomBadges: ["read"],
  admin_siteBadges: ["read"],
  admin_shrt: ["read"],
  admin_msgs: ["read"],
  admin_bots: ["read"],
  admin_subs: ["read"],
  admin_giftsgit: ["read"],
  admin_agentwallets: ["read"],
  admin_giftcommission: ["read", "edit"],
  admin_evaluationpoints: ["read"],
  admin_settings: ["read"],
  admin_database: ["read"],
  admin_micprovidercp: ["read"],
  admin_ddosguardcp: ["read"],
  admin_hostin: ["read"],
  admin_hostcleanup: ["read"],
  admin_hostcontrols: ["read"],
  admin_hostsettings: ["read"],
  admin_hostdomains: ["read"],
};

export function isPermissionActionImplemented(resource: string, action: string): boolean {
  return IMPLEMENTED_PERMISSION_ACTIONS[resource]?.includes(action) ?? false;
}

export function togglePermissionValue(
  current: Record<string, boolean>,
  resource: string,
  action: string,
): Record<string, boolean> {
  if (!isPermissionActionImplemented(resource, action)) return current;

  const key = `${resource}.${action}`;
  const next = { ...current, [key]: !current[key] };
  if (action === "all") {
    ["read", "edit", "delete"].forEach(child => {
      next[`${resource}.${child}`] = next[key];
    });
  } else if (!next[key] && next[`${resource}.all`]) {
    next[`${resource}.all`] = false;
  }
  return next;
}

export function canAccessControlPanel(permissions: readonly string[]): boolean {
  return permissions.includes("cp") ||
    permissions.includes("cp.read") ||
    permissions.includes("cp.all");
}

export function canViewAdminSection(permissions: readonly string[], section: string): boolean {
  const resource = ADMIN_SECTION_PERMISSION_BY_ID[section];
  return resource !== undefined &&
    (permissions.includes(`${resource}.read`) || permissions.includes(`${resource}.all`));
}

export function canManageAdminSection(
  permissions: readonly string[],
  section: string,
  action: "edit" | "delete",
): boolean {
  const resource = ADMIN_SECTION_PERMISSION_BY_ID[section];
  return resource !== undefined &&
    (permissions.includes(`${resource}.${action}`) || permissions.includes(`${resource}.all`));
}

export function canUseVisualResource(permissions: readonly string[], resource: string): boolean {
  return VISUAL_RESOURCES.some(item => item.key === resource) &&
    permissions.includes(`${resource}.use`);
}
