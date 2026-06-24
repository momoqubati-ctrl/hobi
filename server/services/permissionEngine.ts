import { dbPool } from "../db";
import { redis, KEYS } from "./redis";

export type PermissionKey = 
  | "kick" | "ban" | "meiut" | "loveu" | "delpic" | "delmsg" | "delbc"
  | "cp" | "setpower" | "edituser" | "roomowner" | "createroom" | "rooms" | "flter" | "shrt" | "subs" | "upgrades" | "brbbot"
  | "publicmsg" | "forcepm" | "grupes" | "stealth" | "history" | "ulike"
  | "uploadgif" | "gradientname" | "custombg" | "chattem" | "frame" | "banner" | "profile_viewers"
  | "filter_alerts" | "moderation_monitor" | "realtime_admin" | "analytics_access" | "audit_logs" 
  | "manage_notifications" | "manage_wallets" | "manage_domains" | "anti_ddos" | "maintenance_mode";

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
      return {
        userId: parsed.userId,
        roleId: parsed.roleId,
        rankPriority: parsed.rankPriority,
        isStaff: parsed.isStaff,
        permissions: new Set(parsed.permissions || [])
      };
    }
  } catch (err) {
    console.warn(`[PermissionEngine] Redis cache read error for user ${userId}:`, err);
  }

  // 2. في حال عدم وجود كاش، جلب البيانات من PostgreSQL
  const result = await dbPool.query(`
    SELECT 
      u.id as "userId",
      r.id as "roleId",
      r.rank as "rankPriority",
      COALESCE(r.rank >= 9000, false) as "isStaff",
      COALESCE(jsonb_object_agg(rp.permission_key, rp.permission_value) FILTER (WHERE rp.permission_key IS NOT NULL), '{}'::jsonb) as permissions
    FROM users u
    LEFT JOIN user_role_assignments ura ON u.id = ura.user_id
    LEFT JOIN roles r ON ura.role_id = r.id
    LEFT JOIN role_permissions rp ON r.id = rp.role_id
    WHERE u.id = $1
    GROUP BY u.id, r.id, r.rank
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

  const context: UserContext = {
    userId: row.userId,
    roleId: row.roleId,
    rankPriority: row.rankPriority || 0,
    isStaff: row.isStaff || false,
    permissions: perms
  };

  // 3. تخزين النتيجة في كاش Redis لفترة 24 ساعة
  try {
    const serializedContext = {
      userId: context.userId,
      roleId: context.roleId,
      rankPriority: context.rankPriority,
      isStaff: context.isStaff,
      permissions: Array.from(context.permissions)
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