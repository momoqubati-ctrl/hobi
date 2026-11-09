import { db, dbPool } from "../db/index";
import { moderationEvents } from "../db/schema";
import { invalidatePermissionCache } from "./permissionEngine";
import {
  SYSTEM_OWNER_RANK,
  canAssignSystemOwnerRole,
  isSystemOwnerUsername,
} from "./systemOwner";

export type PowerAction = "kick" | "ban" | "alert" | "mute" | "delmsg" | "clear_room";

export interface UserPower {
  rank: number;
  name: string;
  canKick: boolean;
  canBan: boolean;
  canAlert: boolean;
  canMute: boolean;
  canDelMsg: boolean;
  canClearRoom: boolean;
}

// 1. Guest (زائر)
// 2. Member (عضو)
// 3. Moderator (مراقب / سوبر)
// 4. Admin (أدمن / ادمن)
// 5. Owner (مالك / ispower)
export const POWERS_MAP: Record<string, UserPower> = {
  owner: {
    rank: 100000,
    name: "مالك",
    canKick: true,
    canBan: true,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: true,
  },
  ispower: {
    rank: 99999,
    name: "مالك",
    canKick: true,
    canBan: true,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: true,
  },
  مالك: {
    rank: 100000,
    name: "مالك",
    canKick: true,
    canBan: true,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: true,
  },
  admin: {
    rank: 9000,
    name: "مدير",
    canKick: true,
    canBan: true,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: true,
  },
  ادمن: {
    rank: 8000,
    name: "ادمن",
    canKick: true,
    canBan: true,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: true,
  },
  أدمن: {
    rank: 8000,
    name: "أدمن",
    canKick: true,
    canBan: true,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: true,
  },
  moderator: {
    rank: 5000,
    name: "مراقب",
    canKick: true,
    canBan: false,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: false,
  },
  سوبر: {
    rank: 6000,
    name: "سوبر",
    canKick: true,
    canBan: false,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: false,
  },
  مشرف: {
    rank: 5000,
    name: "مشرف",
    canKick: true,
    canBan: false,
    canAlert: true,
    canMute: true,
    canDelMsg: true,
    canClearRoom: false,
  },
  member: {
    rank: 1000,
    name: "عضو",
    canKick: false,
    canBan: false,
    canAlert: false,
    canMute: false,
    canDelMsg: false,
    canClearRoom: false,
  },
  عضو: {
    rank: 1000,
    name: "عضو",
    canKick: false,
    canBan: false,
    canAlert: false,
    canMute: false,
    canDelMsg: false,
    canClearRoom: false,
  },
  guest: {
    rank: 0,
    name: "زائر",
    canKick: false,
    canBan: false,
    canAlert: false,
    canMute: false,
    canDelMsg: false,
    canClearRoom: false,
  },
  زائر: {
    rank: 0,
    name: "زائر",
    canKick: false,
    canBan: false,
    canAlert: false,
    canMute: false,
    canDelMsg: false,
    canClearRoom: false,
  },
};

export const getPowerLevel = (role: string): UserPower => {
  const normalized = String(role || "").toLowerCase().trim();
  return POWERS_MAP[normalized] || POWERS_MAP["guest"];
};

export const canExecuteAction = (actorRole: string, targetRole: string, action: PowerAction): boolean => {
  const actorPower = getPowerLevel(actorRole);
  const targetPower = getPowerLevel(targetRole);

  // لا يمكن اتخاذ إجراء ضد شخص رتبته مساوية أو أعلى
  if (actorPower.rank <= targetPower.rank && targetPower.rank > 0) {
    return false;
  }

  switch (action) {
    case "kick":
      return actorPower.canKick;
    case "ban":
      return actorPower.canBan;
    case "alert":
      return actorPower.canAlert;
    case "mute":
      return actorPower.canMute;
    case "delmsg":
      return actorPower.canDelMsg;
    case "clear_room":
      return actorPower.canClearRoom;
    default:
      return false;
  }
};

export const logModerationEvent = async (params: {
  actorId?: string;
  targetUserId?: string;
  roomId?: string;
  eventType: string;
  reason?: string;
  metadata?: any;
}) => {
  try {
    await db.insert(moderationEvents).values({
      actorId: params.actorId || null,
      targetUserId: params.targetUserId || null,
      roomId: params.roomId || null,
      eventType: params.eventType,
      reason: params.reason || "",
      metadata: params.metadata || {},
    });
  } catch (err) {
    console.error("Error logging moderation event:", err);
  }
};

/**
 * جلب الرتبة الحقيقية الموثقة للمستخدم مباشرة من قاعدة البيانات
 */
export const getUserAuthoritativeRank = async (userIdOrName: string, fallbackUsername?: string) => {
  const normalized = String(userIdOrName || "").trim();
  const normalizedFallback = String(fallbackUsername || "").trim().toLowerCase();
  if (!normalized && !normalizedFallback) return null;

  const result = await dbPool.query(
    `SELECT 
       u.id,
       u.username,
       u.power,
       u.role,
       r.id as role_id,
       r.name as role_name,
       r.legacy_name,
       r.rank as role_rank,
       r.icon_url
     FROM users u
     LEFT JOIN user_role_assignments ura ON ura.user_id = u.id
     LEFT JOIN roles r ON r.id = ura.role_id AND r.is_active = true
     WHERE u.id = $1 
        OR u.uid = $1 
        OR CAST(u.idreg AS text) = $1
        OR lower(u.username) = lower($1)
        OR ($2 <> '' AND lower(u.username) = $2)
     ORDER BY r.rank DESC NULLS LAST
     LIMIT 1`,
    [normalized || normalizedFallback, normalizedFallback]
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0];

  const powerLower = (row.power || "").toLowerCase().trim();
  const usernameLower = (row.username || "").toLowerCase().trim();
  const roleLower = (row.role || "").toLowerCase().trim();

  let rank = row.role_rank || 0;

  if (isSystemOwnerUsername(usernameLower)) {
    rank = Math.max(rank, SYSTEM_OWNER_RANK);
  } else if (["owner", "ispower", "مالك"].includes(powerLower) || ["owner", "ispower", "مالك"].includes(roleLower)) {
    rank = Math.max(rank, 9000);
  } else if (POWERS_MAP[powerLower]) {
    rank = Math.max(rank, POWERS_MAP[powerLower].rank);
  } else if (POWERS_MAP[roleLower]) {
    rank = Math.max(rank, POWERS_MAP[roleLower].rank);
  } else if (rank === 0) {
    rank = 1000;
  }

  return {
    id: String(row.id),
    username: String(row.username),
    roleId: row.role_id ? String(row.role_id) : undefined,
    roleName: isSystemOwnerUsername(row.username)
      ? "Owner"
      : String(row.role_name || row.legacy_name || row.power || "عضو"),
    rank,
    iconUrl: row.icon_url ? String(row.icon_url) : "",
  };
};

/**
 * إسناد أو ترقية أو إزالة رتبة مستخدم بأعلى معايير الأمان ومنع تصعيد الصلاحيات
 */
export const assignUserRole = async ({
  actorId,
  targetUserId,
  roleIdentifier,
  startDate,
  endDate,
}: {
  actorId: string;
  targetUserId: string;
  roleIdentifier?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{ success: boolean; error?: string; roleName?: string; canonicalRole?: string; rank?: number; iconUrl?: string }> => {
  const actor = await getUserAuthoritativeRank(actorId);
  const target = await getUserAuthoritativeRank(targetUserId);

  if (!actor || !target) {
    return { success: false, error: "المستخدم غير موجود" };
  }

  // 1. منع ترقية النفس قطعياً
  if (String(actor.id) === String(target.id)) {
    return { success: false, error: "لا يمكنك تعديل أو ترقية رتبتك بنفسك" };
  }

  const isActorOwner = isSystemOwnerUsername(actor.username);

  if (isSystemOwnerUsername(target.username)) {
    return { success: false, error: "لا يمكن تغيير رتبة مالك الاستضافة" };
  }

  // 2. التحقق من الهرمية: لا يمكن التعديل على رتبة مساوية أو أعلى إلا إذا كان الفاعل مالكاً
  if (target.rank >= actor.rank && !isActorOwner) {
    return { success: false, error: "لا تملك صلاحية لتعديل رتبة مستخدم يملك رتبة أعلى منك أو مساوية لك" };
  }

  const cleanRoleIdent = (roleIdentifier || "").trim();

  // 3. إزالة الترقية وإعادة كعضو عادي
  if (!cleanRoleIdent) {
    await dbPool.query(`UPDATE users SET power = '', role = 'member' WHERE id = $1`, [target.id]);
    await dbPool.query(`UPDATE user_profiles SET power = '' WHERE user_id = $1`, [target.id]);
    await dbPool.query(`DELETE FROM user_role_assignments WHERE user_id = $1`, [target.id]);
    await invalidatePermissionCache(target.id);

    await logModerationEvent({
      actorId: actor.id,
      targetUserId: target.id,
      eventType: "demote_role",
      reason: "إزالة الترقية وإعادة كعضو عادي",
      metadata: { previousRole: target.roleName, previousRank: target.rank },
    });

    return { success: true, roleName: "عضو", canonicalRole: "member", rank: 1000, iconUrl: "" };
  }

  // 4. فحص الرتبة المطلوبة في قاعدة البيانات
  const roleRes = await dbPool.query(
    `SELECT id, name, legacy_name, rank, icon_url, is_active, is_owner
     FROM roles
     WHERE (legacy_name = $1 OR name = $1 OR id::text = $1)
     LIMIT 1`,
    [cleanRoleIdent]
  );

  if (roleRes.rowCount === 0) {
    return { success: false, error: "الرتبة المطلوبة غير مسجلة في النظام" };
  }

  const role = roleRes.rows[0];
  if (role.is_owner && !canAssignSystemOwnerRole(target.username)) {
    return { success: false, error: "رتبة المالك مخصصة لحساب مالك الاستضافة" };
  }
  if (!role.is_active) {
    return { success: false, error: "هذه الرتبة معطلة حالياً ولا يمكن إسنادها" };
  }

  // 5. منع تصعيد الصلاحيات: لا يمكن إسناد رتبة تساوي أو تزيد عن رتبة الفاعل (إلا للمالك)
  if (role.rank >= actor.rank && !isActorOwner) {
    return { success: false, error: "لا يمكنك إسناد رتبة تساوي رتبتك أو أعلى منها" };
  }

  const legacyName = role.legacy_name || role.name;
  const roleLower = String(role.name || legacyName || "").toLowerCase().trim();

  let canonicalRole = "member";
  if (role.is_owner && canAssignSystemOwnerRole(target.username)) {
    canonicalRole = "owner";
  } else if (["admin", "ادمن", "أدمن"].includes(roleLower) || role.rank >= 8000) {
    canonicalRole = "admin";
  } else if (["moderator", "سوبر", "مشرف"].includes(roleLower) || role.rank >= 5000) {
    canonicalRole = "moderator";
  }

  // 6. تحديث الجداول الأساسية
  await dbPool.query(`UPDATE users SET power = $1, role = $2 WHERE id = $3`, [legacyName, canonicalRole, target.id]);
  await dbPool.query(
    `INSERT INTO user_profiles (user_id, power) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET power = $2`,
    [target.id, legacyName]
  );

  // 7. تحديث جدول user_role_assignments
  const startsAt = startDate ? new Date(startDate) : new Date();
  const expiresAt = endDate ? new Date(endDate) : null;

  await dbPool.query(`DELETE FROM user_role_assignments WHERE user_id = $1`, [target.id]);
  await dbPool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, assigned_by, starts_at, expires_at, legacy_metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [target.id, role.id, actor.id, startsAt, expiresAt, JSON.stringify({ assignedByUsername: actor.username })]
  );

  // 8. إبطال كاش الصلاحيات في Redis فوراً
  await invalidatePermissionCache(target.id);

  // 9. تسجيل العملية في سجل الإشراف
  await logModerationEvent({
    actorId: actor.id,
    targetUserId: target.id,
    eventType: "promote_role",
    reason: `ترقية إلى رتبة ${role.name || legacyName}`,
    metadata: {
      newRole: role.name || legacyName,
      roleId: role.id,
      rank: role.rank,
      startsAt,
      expiresAt,
    },
  });

  return {
    success: true,
    roleName: role.name || legacyName,
    canonicalRole,
    rank: role.rank,
    iconUrl: role.icon_url || "",
  };
};
