import { dbPool } from "../db/index";
import { publishSocketEvent } from "../socket/SocketBroker";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";

export interface LevelTierInfo {
  tier: "bronze" | "silver" | "gold" | "diamond" | "crown" | "celestial";
  name: string;
  badgeBg: string;
  badgeBorder: string;
  textColor: string;
}

/**
 * دالة حساب نقاط الخبرة المطلوبة للانتقال من المستوى L إلى L + 1
 * منحنى أسي تصاعدي: 100 * (Level ^ 1.5)
 */
export function getRequiredExp(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.floor(100 * Math.pow(safeLevel, 1.5));
}

/**
 * تحديد الفئة البصرية بحسب رقم المستوى
 */
export function getTierByLevel(level: number): LevelTierInfo {
  if (level >= 100) {
    return {
      tier: "celestial",
      name: "إمبراطوري",
      badgeBg: "bg-gradient-to-r from-red-600 via-amber-500 to-purple-600",
      badgeBorder: "border-amber-400",
      textColor: "text-amber-100",
    };
  }
  if (level >= 75) {
    return {
      tier: "crown",
      name: "أسطوري",
      badgeBg: "bg-gradient-to-r from-purple-700 to-indigo-600",
      badgeBorder: "border-purple-300",
      textColor: "text-purple-100",
    };
  }
  if (level >= 50) {
    return {
      tier: "diamond",
      name: "ماسي",
      badgeBg: "bg-gradient-to-r from-cyan-600 to-blue-600",
      badgeBorder: "border-cyan-300",
      textColor: "text-cyan-100",
    };
  }
  if (level >= 25) {
    return {
      tier: "gold",
      name: "ذهبي",
      badgeBg: "bg-gradient-to-r from-amber-500 to-yellow-600",
      badgeBorder: "border-yellow-200",
      textColor: "text-yellow-950 font-bold",
    };
  }
  if (level >= 10) {
    return {
      tier: "silver",
      name: "فضي",
      badgeBg: "bg-gradient-to-r from-slate-400 to-zinc-500",
      badgeBorder: "border-slate-200",
      textColor: "text-white",
    };
  }
  return {
    tier: "bronze",
    name: "برونزي",
    badgeBg: "bg-gradient-to-r from-amber-800 to-amber-900",
    badgeBorder: "border-amber-700/50",
    textColor: "text-amber-100",
  };
}

// محدد معدل إضافة نقاط المحادثات النصية (رسالة كل 5 ثوانٍ كحد أقصى لكسب النقاط)
const chatCooldownMap = new Map<string, number>();

/**
 * فحص إمكانية كسب نقاط من المحادثة النصية
 */
export function canGainChatExp(userId: string): boolean {
  const now = Date.now();
  const lastTime = chatCooldownMap.get(userId) || 0;
  if (now - lastTime < 5000) {
    return false;
  }
  chatCooldownMap.set(userId, now);
  // تنظيف الذاكرة دورياً
  if (chatCooldownMap.size > 5000) {
    chatCooldownMap.clear();
  }
  return true;
}

/**
 * إضافة نقاط خبرة للمستخدم مع معالجة الترقية ونشر الإشعارات
 */
export async function addUserExp(
  userId: string,
  amount: number,
  options?: {
    roomId?: string;
    username?: string;
    io?: Server;
    source?: "chat" | "voice_stage" | "gift" | "daily";
  }
): Promise<{ level: number; exp: number; nextExp: number; leveledUp: boolean }> {
  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId || cleanUserId === "0" || amount <= 0) {
    return { level: 1, exp: 0, nextExp: 100, leveledUp: false };
  }

  try {
    const res = await dbPool.query(
      `SELECT level, exp FROM user_profiles WHERE user_id = $1`,
      [cleanUserId]
    );

    let currentLevel = 1;
    let currentExp = 0;

    if (res.rows.length > 0) {
      currentLevel = Math.max(1, parseInt(res.rows[0].level, 10) || 1);
      currentExp = Math.max(0, parseInt(res.rows[0].exp, 10) || 0);
    }

    let updatedExp = currentExp + amount;
    let updatedLevel = currentLevel;
    let leveledUp = false;

    let requiredExp = getRequiredExp(updatedLevel);
    while (updatedExp >= requiredExp) {
      updatedExp -= requiredExp;
      updatedLevel += 1;
      leveledUp = true;
      requiredExp = getRequiredExp(updatedLevel);
    }

    // حفظ التحديث في قاعدة البيانات
    await dbPool.query(
      `UPDATE user_profiles SET level = $1, exp = $2 WHERE user_id = $3`,
      [updatedLevel, updatedExp, cleanUserId]
    );

    // إذا حدث ارتقاء في المستوى
    if (leveledUp) {
      const tierInfo = getTierByLevel(updatedLevel);

      // 1. إرسال إشعار شخصي مباشر للمستخدم عبر السوكيت
      if (options?.io) {
        options.io.to(`user:${cleanUserId}`).emit("user:level_up", {
          newLevel: updatedLevel,
          tier: tierInfo,
          exp: updatedExp,
          nextExp: requiredExp,
        });
      }

      // 2. إرسال إعلان تهنئة في الغرفة المتواجد فيها العضو
      if (options?.roomId) {
        const announcementMsg = {
          id: randomUUID(),
          roomId: options.roomId,
          user: "النظام",
          userId: "system",
          role: "system",
          avatar: "/system-level.png",
          isSystem: true,
          systemType: "level_up",
          text: `🎉 تهانينا الحارة لـ ${options.username || "عضو الغرفة"} لارتقائه إلى المستوى [ ${updatedLevel} ]! 🚀`,
          metadata: {
            userId: cleanUserId,
            username: options.username,
            newLevel: updatedLevel,
            tier: tierInfo.tier,
          },
          createdAt: new Date().toISOString(),
        };

        // النشر لجميع المتواجدين في الغرفة
        publishSocketEvent(options.roomId, "new_message", {
          roomId: options.roomId,
          message: announcementMsg,
        }).catch((err) => console.error("Error broadcasting level-up message:", err));

        if (options.io) {
          options.io.to(`room:${options.roomId}`).emit("room:member_level_up", {
            userId: cleanUserId,
            username: options.username,
            newLevel: updatedLevel,
            tier: tierInfo,
          });
        }
      }
    }

    return {
      level: updatedLevel,
      exp: updatedExp,
      nextExp: requiredExp,
      leveledUp,
    };
  } catch (error) {
    console.error(`[userLevelService] Failed to add EXP for ${cleanUserId}:`, error);
    return { level: 1, exp: 0, nextExp: 100, leveledUp: false };
  }
}
