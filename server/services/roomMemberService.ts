import { dbPool } from "../db/index";
import { POWERS_MAP, getPowerLevel } from "./powersService";

export type RoomRole = "owner" | "co_owner" | "super_admin" | "moderator" | "vip" | "member" | "guest";

export interface RoomRoleDefinition {
  role: RoomRole;
  power: number;
  name: string;
  badge: string;
  color: string;
  canKick: boolean;
  canMute: boolean;
  canBan: boolean;
  canManageMics: boolean;
  canPin: boolean;
  canSetRole: boolean;
}

export const ROOM_ROLES_CONFIG: Record<RoomRole, RoomRoleDefinition> = {
  owner: {
    role: "owner",
    power: 100000,
    name: "مالك الغرفة",
    badge: "👑",
    color: "text-amber-500",
    canKick: true,
    canMute: true,
    canBan: true,
    canManageMics: true,
    canPin: true,
    canSetRole: true,
  },
  co_owner: {
    role: "co_owner",
    power: 80000,
    name: "مالك مشارك",
    badge: "⭐",
    color: "text-amber-400",
    canKick: true,
    canMute: true,
    canBan: true,
    canManageMics: true,
    canPin: true,
    canSetRole: true,
  },
  super_admin: {
    role: "super_admin",
    power: 50000,
    name: "مشرف عام",
    badge: "🛡️",
    color: "text-blue-500",
    canKick: true,
    canMute: true,
    canBan: true,
    canManageMics: true,
    canPin: true,
    canSetRole: false,
  },
  moderator: {
    role: "moderator",
    power: 30000,
    name: "مشرف",
    badge: "⚔️",
    color: "text-emerald-500",
    canKick: true,
    canMute: true,
    canBan: false,
    canManageMics: true,
    canPin: false,
    canSetRole: false,
  },
  vip: {
    role: "vip",
    power: 10000,
    name: "عضو مميز",
    badge: "💎",
    color: "text-purple-400",
    canKick: false,
    canMute: false,
    canBan: false,
    canManageMics: false,
    canPin: false,
    canSetRole: false,
  },
  member: {
    role: "member",
    power: 1000,
    name: "عضو",
    badge: "👤",
    color: "text-slate-300",
    canKick: false,
    canMute: false,
    canBan: false,
    canManageMics: false,
    canPin: false,
    canSetRole: false,
  },
  guest: {
    role: "guest",
    power: 100,
    name: "زائر",
    badge: "👁️",
    color: "text-slate-400",
    canKick: false,
    canMute: false,
    canBan: false,
    canManageMics: false,
    canPin: false,
    canSetRole: false,
  },
};

export function getRoomRolePower(role: string): number {
  const normalized = (role || "").toLowerCase() as RoomRole;
  return ROOM_ROLES_CONFIG[normalized]?.power || 1000;
}

/**
 * فحص الصلاحية الأمنية لاتخاذ إجراء داخل الغرفة (Superiority Check)
 */
export function canModerateInRoom(
  actor: { globalRole: string; roomRole: string; roomPower?: number },
  target: { globalRole: string; roomRole: string; roomPower?: number }
): boolean {
  const actorGlobalPower = getPowerLevel(actor.globalRole).rank;
  const targetGlobalPower = getPowerLevel(target.globalRole).rank;

  // 1. حصانة إدارة الموقع: لا يمكن لأحد طرد أو معاقبة مشرف الموقع إلا مشرف أعلى منه
  if (targetGlobalPower >= 9000) {
    return actorGlobalPower > targetGlobalPower;
  }

  // 2. إذا كان المنفذ أدمن في الموقع
  if (actorGlobalPower >= 9000) {
    return true;
  }

  // 3. الاحتكام إلى قوة رتبة الغرفة
  const actorPower = actor.roomPower ?? getRoomRolePower(actor.roomRole);
  const targetPower = target.roomPower ?? getRoomRolePower(target.roomRole);

  return actorPower > targetPower;
}

/**
 * جلب تفاصيل عضو في غرفة
 */
export async function getRoomMember(roomId: string, userId: string): Promise<{
  role: RoomRole;
  power: number;
  customTitle: string;
  badgeId: string | null;
} | null> {
  try {
    const res = await dbPool.query(
      `SELECT role, power, custom_title, badge_id 
       FROM room_members 
       WHERE (room_id = $1 OR room_id IN (SELECT CAST(id AS text) FROM rooms WHERE slug = $1))
         AND user_id = $2 
       LIMIT 1`,
      [roomId, userId]
    );
    if (res.rows.length === 0) return null;
    return {
      role: res.rows[0].role as RoomRole,
      power: res.rows[0].power,
      customTitle: res.rows[0].custom_title || "",
      badgeId: res.rows[0].badge_id,
    };
  } catch (err) {
    console.error("[roomMemberService] getRoomMember error:", err);
    return null;
  }
}

/**
 * تعيين أو تحديث دور عضو داخل الغرفة
 */
export async function setRoomMemberRole(params: {
  roomId: string;
  actorUserId: string;
  targetUserId: string;
  newRole: RoomRole;
  customTitle?: string;
  badgeId?: string | null;
}): Promise<{ success: boolean; message: string }> {
  try {
    // 1. التحقق من صلاحيات المنفذ (Actor)
    // فحص ما إذا كان المالك المسجل للغرفة (Fix #5: دعم المعرف والـ slug و owner_id)
    const roomRes = await dbPool.query(
      `SELECT CAST(id AS text) as id, slug, owner_id, owner, "user" 
       FROM rooms 
       WHERE CAST(id AS text) = $1 OR slug = $1 
       LIMIT 1`,
      [params.roomId]
    );
    if (roomRes.rows.length === 0) {
      return { success: false, message: "الغرفة غير موجودة" };
    }
    const roomRow = roomRes.rows[0];
    const canonicalRoomId = String(roomRow.id || params.roomId);
    const cleanOwnerRef = String(roomRow.owner || "").replace(/^#+/, "").trim();
    const isOwner = Boolean(
      (roomRow.owner_id && String(roomRow.owner_id) === String(params.actorUserId)) ||
      (cleanOwnerRef && cleanOwnerRef === String(params.actorUserId)) ||
      (roomRow.user && String(roomRow.user).toLowerCase() === String(params.actorUserId).toLowerCase())
    );

    let actorPower = isOwner ? 100000 : 0;
    if (!isOwner) {
      const actorMember = await getRoomMember(canonicalRoomId, params.actorUserId);
      actorPower = actorMember?.power || 0;
    }

    const targetRolePower = getRoomRolePower(params.newRole);

    // المنفذ لا يستطيع منح رتبة تساوي قوته أو تعلوه إلا إذا كان مالك الغرفة
    if (!isOwner && targetRolePower >= actorPower) {
      return { success: false, message: "لا تملك الصلاحية لمنح هذه الرتبة" };
    }

    const newPower = ROOM_ROLES_CONFIG[params.newRole]?.power || 1000;

    await dbPool.query(
      `INSERT INTO room_members (room_id, user_id, role, power, custom_title, badge_id, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET
         role = EXCLUDED.role,
         power = EXCLUDED.power,
         custom_title = COALESCE(EXCLUDED.custom_title, room_members.custom_title),
         badge_id = COALESCE(EXCLUDED.badge_id, room_members.badge_id)`,
      [
        canonicalRoomId,
        params.targetUserId,
        params.newRole,
        newPower,
        params.customTitle || null,
        params.badgeId || null,
      ]
    );

    return { success: true, message: "تم تحديث الرتبة بنجاح" };
  } catch (err: any) {
    console.error("[roomMemberService] setRoomMemberRole error:", err);
    return { success: false, message: err?.message || "فشل تحديث الرتبة" };
  }
}
