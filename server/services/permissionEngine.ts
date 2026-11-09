import { dbPool } from "../db";
import { redis, KEYS } from "./redis";
import { SYSTEM_OWNER_RANK, isSystemOwnerUsername } from "./systemOwner";
import { CHAT_FEATURE_PERMISSION_KEYS } from "../../src/lib/chatFeaturePermissions";

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
  | "roomowner" | "createroom" | "rooms" | "publicmsg" | "publicmsghide" | "bot" | "grupes" | "lockedroom"
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
  | "admin_rooms" | "admin_stickers" | "admin_gifts" | "admin_swiperbanners" | "admin_profileframes" | "admin_membercardtheme"
  | "admin_icons" | "admin_animatedfaces"
  | "admin_roomBadges" | "admin_siteBadges"
  | "admin_shrt" | "admin_msgs" | "admin_bots"
  | "admin_subs" | "admin_giftsgit" | "admin_agentwallets" | "admin_giftcommission" | "admin_evaluationpoints"
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
  | (typeof CHAT_FEATURE_PERMISSION_KEYS)[number]
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
      const actions = RESOURCE_ACTIONS[resource]?.filter(action => action !== "all")
        ?? ["read", "edit", "delete"];
      actions.forEach(action => expanded.add(`${resource}.${action}`));
    }
  }
  return expanded;
}

// ──────────────────────────────────────────────────
// أنواع الـ CRUD لكل مورد
// ──────────────────────────────────────────────────
export const RESOURCE_ACTIONS: Record<string, string[]> = {
  ...Object.fromEntries(
    CHAT_FEATURE_PERMISSION_KEYS.map((permission) => [
      permission.slice(0, permission.lastIndexOf(".")),
      ["use"],
    ]),
  ),
  // Basic: read / edit / delete + all
  ...Object.fromEntries(
    ([
      "kick", "ban", "meiut", "delmsg", "delbc", "delpic", "alert", "forcepm", "history",
      "edituser", "setpower", "stealth", "mynick", "unick", "loveu", "ulike", "status_color", "reveal", "profile_viewers",
      "roomowner", "createroom", "rooms", "publicmsg", "publicmsghide", "bot", "grupes", "lockedroom",
      "flter", "shrt", "subs", "upgrades", "msgs", "micprovideredit", "evaluationpoints", "bootedit", "gift", "filter_alerts",
      "moderation_monitor", "realtime_admin", "analytics_access", "audit_logs",
      "manage_notifications", "manage_wallets", "manage_domains", "anti_ddos", "maintenance_mode",
      "cp",
      "admin_overview", "admin_events", "admin_actions",
      "admin_users", "admin_bans", "admin_roles", "admin_fltr",
      "admin_rooms", "admin_stickers", "admin_gifts", "admin_swiperbanners", "admin_profileframes", "admin_membercardtheme",
      "admin_icons", "admin_animatedfaces",
      "admin_roomBadges", "admin_siteBadges",
      "admin_shrt", "admin_msgs", "admin_bots",
      "admin_subs", "admin_giftsgit", "admin_agentwallets", "admin_giftcommission", "admin_evaluationpoints",
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
      const cachedContext = {
        userId: parsed.userId,
        roleId: parsed.roleId,
        rankPriority: parsed.rankPriority,
        isStaff: parsed.isStaff,
        permissions: expandAllPermissions(perms),
      };
      if (cachedContext.roleId || cachedContext.permissions.size > 0) return cachedContext;
      await redis.del(cacheKey);
    }
  } catch (err) {
    console.warn(`[PermissionEngine] Redis cache read error for user ${userId}:`, err);
  }

  // 2. في حال عدم وجود كاش، جلب البيانات من PostgreSQL
  const result = await dbPool.query(`
    SELECT 
      u.id as "userId",
      u.username as "username",
      u.power as "power",
      (SELECT assigned_role.id
       FROM user_role_assignments role_assignment
       JOIN roles assigned_role ON assigned_role.id = role_assignment.role_id
       WHERE role_assignment.user_id = u.id
         AND assigned_role.is_active = true
         AND role_assignment.starts_at <= now()
         AND (role_assignment.expires_at IS NULL OR role_assignment.expires_at > now())
       ORDER BY assigned_role.rank DESC
       LIMIT 1) as "roleId",
      COALESCE(MAX(r.rank), 0) as "rankPriority",
      COALESCE(BOOL_OR(r.rank >= 9000), false) as "isStaff",
      COALESCE(BOOL_OR(r.is_owner), false) as "assignedOwner",
      (SELECT owner_role.id
       FROM user_role_assignments owner_assignment
       JOIN roles owner_role ON owner_role.id = owner_assignment.role_id
       WHERE owner_assignment.user_id = u.id
         AND owner_role.is_owner = true
       LIMIT 1) as "ownerRoleId",
      COALESCE((
        SELECT jsonb_object_agg(granted.permission_key, true)
        FROM (
          SELECT DISTINCT rp.permission_key
          FROM user_role_assignments permission_assignment
          JOIN roles permission_role
            ON permission_role.id = permission_assignment.role_id
           AND permission_role.is_active = true
          JOIN role_permissions rp ON rp.role_id = permission_role.id
          WHERE permission_assignment.user_id = u.id
            AND permission_assignment.starts_at <= now()
            AND (permission_assignment.expires_at IS NULL OR permission_assignment.expires_at > now())
            AND rp.permission_value = 'true'::jsonb
        ) granted
      ), '{}'::jsonb) as permissions
    FROM users u
    LEFT JOIN user_role_assignments ura
      ON u.id = ura.user_id
     AND ura.starts_at <= now()
     AND (ura.expires_at IS NULL OR ura.expires_at > now())
    LEFT JOIN roles r ON ura.role_id = r.id AND r.is_active = true
    WHERE u.id = $1
    GROUP BY u.id, u.username, u.power
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

  const isOwner = isSystemOwnerUsername(row.username) && row.assignedOwner === true;
  if (isOwner) {
    for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
      for (const action of actions) {
        perms.add(`${resource}.${action}`);
      }
    }
  }

  const context: UserContext = {
    userId: row.userId,
    roleId: row.ownerRoleId || row.roleId || undefined,
    rankPriority: isOwner ? SYSTEM_OWNER_RANK : Number(row.rankPriority) || 0,
    isStaff: isOwner || row.isStaff || false,
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