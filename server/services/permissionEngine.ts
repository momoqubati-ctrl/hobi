import { dbPool } from "../db";
import { redis, KEYS } from "./redis";

// ──────────────────────────────────────────────────
// الموارد (Resources) - كل مورد تحته read/edit/delete
// والموارد الـ visual تحتها use فقط
// ──────────────────────────────────────────────────

/** الموارد الأساسية (Basic Resources) - read/edit/delete */
export type BasicResource =
  // ── Chat Moderation ──
  | "kick" | "ban" | "meiut" | "delmsg" | "delbc" | "delpic" | "alert" | "forcepm" | "history"
  // ── Members & Hierarchy ──
  | "edituser" | "setpower" | "stealth" | "mynick" | "unick" | "loveu" | "ulike" | "status_color" | "reveal" | "profile_viewers"
  // ── Rooms & Communication ──
  | "roomowner" | "createroom" | "rooms" | "publicmsg" | "publicmsghide" | "bot" | "grupes"
  // ── Management ──
  | "flter" | "shrt" | "subs" | "upgrades" | "msgs" | "micprovideredit" | "evaluationpoints" | "bootedit" | "gift" | "filter_alerts"
  // ── System ──
  | "moderation_monitor" | "realtime_admin" | "analytics_access" | "audit_logs"
  | "manage_notifications" | "manage_wallets" | "manage_domains" | "anti_ddos" | "maintenance_mode"
  // ── CP ──
  | "cp"
  // ── Admin Tabs ──
  | "admin_overview" | "admin_events" | "admin_actions"
  | "admin_users" | "admin_bans" | "admin_roles" | "admin_fltr"
  | "admin_rooms" | "admin_stickers" | "admin_swiperbanners" | "admin_icons" | "admin_animatedfaces"
  | "admin_roomBadges" | "admin_siteBadges"
  | "admin_shrt" | "admin_msgs" | "admin_bots"
  | "admin_subs" | "admin_giftsgit" | "admin_agentwallets" | "admin_evaluationpoints"
  | "admin_settings" | "admin_database" | "admin_micprovidercp" | "admin_ddosguardcp"
  | "admin_hostin" | "admin_hostcleanup" | "admin_hostcontrols" | "admin_hostsettings" | "admin_hostdomains";

/** الموارد البصرية (Visual Resources) - use فقط */
export type VisualResource =
  | "uploadgif" | "gradientname" | "custombg" | "chattem" | "frame" | "banner" | "icon" | "gifticon";

/** كل أنواع الصلاحيات */
export type PermissionKey =
  | `${BasicResource}.read`
  | `${BasicResource}.edit`
  | `${BasicResource}.delete`
  | `${BasicResource}.all`
  | `${VisualResource}.use`
  | "cp.all";

// ──────────────────────────────────────────────────
// خريطة: .all → يمنح read + edit + delete
// ──────────────────────────────────────────────────
const ALL_CHILDREN: Record<string, string[]> = {
  "basic": ["read", "edit", "delete"],
};

/** توسيع الصلاحيات: لو المستخدم عنده X.all نضيف X.read, X.edit, X.delete */
export function expandAllPermissions(perms: Set<string>): Set<string> {
  const expanded = new Set(perms);
  for (const key of perms) {
    const dot = key.lastIndexOf(".");
    if (dot === -1) continue;
    const resource = key.slice(0, dot);
    const suffix = key.slice(dot + 1);
    if (suffix === "all") {
      expanded.add(`${resource}.read`);
      expanded.add(`${resource}.edit`);
      expanded.add(`${resource}.delete`);
    }
  }
  return expanded;
}

// ──────────────────────────────────────────────────
// أنواع الـ CRUD لكل مورد
// ──────────────────────────────────────────────────
export const RESOURCE_ACTIONS: Record<string, string[]> = {
  // Basic: read / edit / delete + all
  ...Object.fromEntries(
    ([
      "kick", "ban", "meiut", "delmsg", "delbc", "delpic", "alert", "forcepm", "history",
      "edituser", "setpower", "stealth", "mynick", "unick", "loveu", "ulike", "status_color", "reveal", "profile_viewers",
      "roomowner", "createroom", "rooms", "publicmsg", "publicmsghide", "bot", "grupes",
      "flter", "shrt", "subs", "upgrades", "msgs", "micprovideredit", "evaluationpoints", "bootedit", "gift", "filter_alerts",
      "moderation_monitor", "realtime_admin", "analytics_access", "audit_logs",
      "manage_notifications", "manage_wallets", "manage_domains", "anti_ddos", "maintenance_mode",
      "cp",
      "admin_overview", "admin_events", "admin_actions",
      "admin_users", "admin_bans", "admin_roles", "admin_fltr",
      "admin_rooms", "admin_stickers", "admin_swiperbanners", "admin_icons", "admin_animatedfaces",
      "admin_roomBadges", "admin_siteBadges",
      "admin_shrt", "admin_msgs", "admin_bots",
      "admin_subs", "admin_giftsgit", "admin_agentwallets", "admin_evaluationpoints",
      "admin_settings", "admin_database", "admin_micprovidercp", "admin_ddosguardcp",
      "admin_hostin", "admin_hostcleanup", "admin_hostcontrols", "admin_hostsettings", "admin_hostdomains",
    ] as const).map(r => [r, ["read", "edit", "delete", "all"]])
  ),
  // Visual: use only
  ...Object.fromEntries(
    (["uploadgif", "gradientname", "custombg", "chattem", "frame", "banner", "icon", "gifticon"] as const)
      .map(r => [r, ["use"]])
  ),
};

export type ResourceName = keyof typeof RESOURCE_ACTIONS;

// ──────────────────────────────────────────────────
// واجهة سياق المستخدم
// ──────────────────────────────────────────────────
export interface UserContext {
  userId: string;
  roleId?: string;
  rankPriority: number;
  isStaff: boolean;
  permissions: Set<string>;
}

/**
 * جلب سياق المستخدم الكامل (الرتبة + الصلاحيات)
 */
export const getUserContext = async (userId: string): Promise<UserContext> => {
  const cacheKey = KEYS.permissions(userId);

  // 1. محاولة الجلب من Redis Cache
  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      const perms = new Set(parsed.permissions || []);
      return {
        userId: parsed.userId,
        roleId: parsed.roleId,
        rankPriority: parsed.rankPriority,
        isStaff: parsed.isStaff,
        permissions: expandAllPermissions(perms),
      };
    }
  } catch (err) {
    console.warn(`[PermissionEngine] Redis cache read error for user ${userId}:`, err);
  }

  // 2. في حال عدم وجود كاش، جلب البيانات من PostgreSQL
  const result = await dbPool.query(`
    SELECT 
      u.id as "userId",
      u.power as "power",
      r.id as "roleId",
      r.rank as "rankPriority",
      COALESCE(r.rank >= 9000, false) as "isStaff",
      COALESCE(jsonb_object_agg(rp.permission_key, rp.permission_value) FILTER (WHERE rp.permission_key IS NOT NULL), '{}'::jsonb) as permissions
    FROM users u
    LEFT JOIN user_role_assignments ura ON u.id = ura.user_id
    LEFT JOIN roles r ON ura.role_id = r.id
    LEFT JOIN role_permissions rp ON r.id = rp.role_id
    WHERE u.id = $1
    GROUP BY u.id, u.power, r.id, r.rank
  `, [userId]);

  if (result.rowCount === 0) {
    return { userId, rankPriority: 0, isStaff: false, permissions: new Set() };
  }

  const row = result.rows[0];
  const perms = new Set<string>();
  Object.entries(row.permissions || {}).forEach(([key, val]) => {
    if (val === true || val === 1 || String(val) === "true") {
      perms.add(key);
    }
  });

  // منح كافة الصلاحيات لمستخدم الـ owner (ispower) حتى لو لم يكن مرتبطاً برتبة
  const userPower = (row.power || "").toLowerCase().trim();
  if (userPower === "owner" || userPower === "ispower") {
    const allResources = Object.keys(RESOURCE_ACTIONS);
    for (const resource of allResources) {
      perms.add(`${resource}.all`);
    }
  }

  const context: UserContext = {
    userId: row.userId,
    roleId: row.roleId,
    rankPriority: row.rankPriority || 0,
    isStaff: userPower === "owner" || userPower === "ispower" ? true : (row.isStaff || false),
    permissions: expandAllPermissions(perms),
  };

  // 3. تخزين النتيجة في كاش Redis لفترة 24 ساعة
  try {
    const serializedContext = {
      userId: context.userId,
      roleId: context.roleId,
      rankPriority: context.rankPriority,
      isStaff: context.isStaff,
      permissions: Array.from(context.permissions),
    };
    await redis.set(cacheKey, JSON.stringify(serializedContext));
    await redis.expire(cacheKey, 86400); // 24 ساعة صلاحية الكاش
  } catch (err) {
    console.warn(`[PermissionEngine] Redis cache write error for user ${userId}:`, err);
  }

  return context;
};

/**
 * التحقق من امتلاك صلاحية معينة
 */
export const hasPermission = async (userId: string, permission: PermissionKey): Promise<boolean> => {
  const context = await getUserContext(userId);
  return context.permissions.has(permission);
};

/**
 * التحقق من الهرمية (هل يمكن للمستخدم الأول التحكم في الثاني؟)
 */
export const canModerate = async (actorId: string, targetId: string): Promise<boolean> => {
  const actor = await getUserContext(actorId);
  const target = await getUserContext(targetId);

  // لا يمكن التحكم في رتبة مساوية أو أعلى
  return actor.rankPriority > target.rankPriority;
};

/**
 * تفريغ الكاش عند تحديث الرتب
 */
export const invalidatePermissionCache = async (userId?: string) => {
  if (userId) {
    try {
      await redis.del(KEYS.permissions(userId));
    } catch (err) {
      console.warn(`[PermissionEngine] Redis cache delete error for user ${userId}:`, err);
    }
  }
};