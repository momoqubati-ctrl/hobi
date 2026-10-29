import { Socket, Server as SocketIOServer } from "socket.io";
import { ProfileService } from "../services/profileService";
import { createNotification } from "../services/notificationService";
import { db, dbPool } from "../db";
import { userProfiles } from "../db/schema";
import { eq } from "drizzle-orm";
import { hasPermission, PermissionKey, getUserContext, invalidatePermissionCache } from "../services/permissionEngine";
import { getAllOnlineUsers, updateUserRolePresence } from "./presenceManager";
import { canExecuteAction, logModerationEvent, PowerAction, getPowerLevel, assignUserRole, getUserAuthoritativeRank } from "../services/powersService";
import { listRooms } from "../services/chatStore";
import { issueToken } from "../services/authService";

type AdminAction =
  | "nick"
  | "message"
  | "likes"
  | "site_badge"
  | "power"
  | "room_move"
  | "room_kick"
  | "room_mute"
  | "room_unmute"
  | "history"
  | "kick"
  | "delete_pic"
  | "ban"
  | "global_mute"
  | "pull_to_room";

const ADMIN_ACTION_PERMISSION: Partial<Record<AdminAction, PermissionKey>> = {
  nick: "edituser",
  message: "edituser",
  likes: "ulike",
  site_badge: "edituser",
  power: "setpower",
  room_move: "loveu",
  pull_to_room: "loveu",
  history: "history",
  kick: "kick",
  delete_pic: "kick",
  ban: "ban",
  global_mute: "meiut",
};

const normalizeId = (value: unknown) => String(value || "").trim();

const canRunAdminAction = async (socket: Socket, userId: string, action: AdminAction) => {
  const role = String(socket.data.user?.role || "").toLowerCase().trim();
  if (["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"].includes(role)) return true;

  if (action === "room_kick" || action === "room_mute" || action === "room_unmute") {
    return ["moderator", "سوبر", "مشرف"].includes(role);
  }

  const permission = ADMIN_ACTION_PERMISSION[action];
  if (!permission) return false;

  try {
    return (
      (await hasPermission(userId, `${permission}.edit` as any)) ||
      (await hasPermission(userId, `${permission}.all` as any)) ||
      (await hasPermission(userId, `${permission}.read` as any)) ||
      (await hasPermission(userId, permission as any))
    );
  } catch (error) {
    console.warn(`[ProfilePermissions] failed to check ${permission} for ${userId}:`, error);
    return false;
  }
};

const findOnlineUser = async (profileId: string, username?: string) => {
  const targetId = normalizeId(profileId).toLowerCase();
  const targetName = normalizeId(username).toLowerCase();
  const candidates: any[] = [];

  // 1. البحث في سوكيتات السيرفر المحلية (موثوقة ومحدثة لحظياً)
  try {
    const { getIO } = await import("./index");
    const io = getIO();
    if (io) {
      for (const [, s] of io.sockets.sockets) {
        const ud = s.data?.user;
        if (!ud) continue;
        const sid = normalizeId(ud.id).toLowerCase();
        const sname = normalizeId(ud.username).toLowerCase();
        if (sid === targetId || sname === targetName) {
          let rId = ud.roomId || "";
          if (!rId) {
            for (const rm of s.rooms) {
              if (rm.startsWith("room:")) {
                rId = rm.substring(5);
                break;
              }
            }
          }
          candidates.push({
            id: ud.id,
            socketId: s.id,
            username: ud.username,
            role: ud.role,
            avatar: ud.avatar,
            countryCode: ud.countryCode,
            avatarFrameUrl: ud.avatarFrameUrl,
            giftIconUrl: ud.giftIconUrl,
            memberCardBgUrl: ud.memberCardBgUrl,
            roomId: rId,
            status: ud.status || "online",
            connectedAt: ud.connectedAt,
          });
        }
      }
    }
  } catch (err) {
    console.error("findOnlineUser local sockets error:", err);
  }

  // 2. البحث في حضور المستخدمين العام
  try {
    const onlineUsers = await getAllOnlineUsers();
    for (const user of onlineUsers) {
      if (!user) continue;
      const id = normalizeId(user.id).toLowerCase();
      const name = normalizeId(user.username).toLowerCase();
      if (id === targetId || name === targetName || name === targetId) {
        candidates.push(user);
      }
    }
  } catch (err) {
    console.error("findOnlineUser presenceManager error:", err);
  }

  // 3. اختيار أفضل مرشح (يفضل المرشح الذي يتواجد في غرفة حالياً)
  const bestWithRoom = candidates.find(c => c && c.roomId);
  if (bestWithRoom) return bestWithRoom;

  if (candidates.length > 0) return candidates[0];
  return undefined;
};

const findTargetSocket = (io: SocketIOServer, profileId: string, username?: string, excludeSocketId?: string) => {
  const targetId = normalizeId(profileId).toLowerCase();
  const targetName = normalizeId(username).toLowerCase();

  for (const [, s] of io.sockets.sockets) {
    if (excludeSocketId && s.id === excludeSocketId) continue;
    const ud = s.data?.user;
    if (!ud) continue;
    const sid = normalizeId(ud.id).toLowerCase();
    const sname = normalizeId(ud.username).toLowerCase();
    if (sid === targetId || sname === targetName) {
      return s;
    }
  }
  return null;
};

const applyLegacyProfileUpdate = async (profileId: string, updates: Record<string, unknown>) => {
  const normalizedProfileId = normalizeId(profileId);
  if (!normalizedProfileId) return false;

  const profileLookup = await dbPool.query(
    `SELECT "id"
     FROM "users"
     WHERE CAST("uid" AS text) = $1
        OR CAST("id" AS text) = $1
        OR CAST("idreg" AS text) = $1
        OR lower("username") = lower($1)
     LIMIT 1`,
    [normalizedProfileId],
  );
  const actualUserId = String(profileLookup.rows[0]?.id || normalizedProfileId);

  const profileFields: string[] = [];
  const profileValues: unknown[] = [];
  const legacyFields: string[] = [];
  const legacyValues: unknown[] = [];
  let profileIndex = 1;
  let legacyIndex = 1;

  const addProfileField = (column: string, value: unknown) => {
    profileFields.push(`"${column}" = $${profileIndex++}`);
    profileValues.push(value);
  };

  const addLegacyField = (column: string, value: unknown) => {
    legacyFields.push(`"${column}" = $${legacyIndex++}`);
    legacyValues.push(value);
  };

  if (updates.topic !== undefined) addLegacyField("topic", String(updates.topic).slice(0, 120));
  if (updates.msg !== undefined) {
    const message = String(updates.msg).slice(0, 500);
    addLegacyField("msg", message);
    addProfileField("profile_msg", message);
  }
  if (updates.wall_post_likes !== undefined) {
    const value = Number(updates.wall_post_likes) || 0;
    addLegacyField("wall_post_likes", value);
    addProfileField("wall_post_likes", value);
  }
  if (updates.site_badge !== undefined) {
    const value = String(updates.site_badge).slice(0, 120);
    addLegacyField("site_badge", value);
    addProfileField("site_badge", value);
  }
  if (updates.power !== undefined) {
    const value = String(updates.power).slice(0, 80);
    addLegacyField("power", value);
    addProfileField("power", value);
  }
  if (updates.pic !== undefined) {
    const value = String(updates.pic).slice(0, 255);
    addLegacyField("pic", value);
    addProfileField("avatar_url", value);
  }
  if (updates.muted !== undefined) {
    const value = updates.muted ? 1 : 0;
    addLegacyField("muted", value);
    addProfileField("muted", Boolean(updates.muted));
  }

  if (legacyFields.length > 0) {
    await dbPool.query(
      `UPDATE "users"
       SET ${legacyFields.join(", ")}
       WHERE CAST("uid" AS text) = $${legacyIndex}
          OR CAST("id" AS text) = $${legacyIndex}
          OR CAST("idreg" AS text) = $${legacyIndex}
          OR lower("username") = lower($${legacyIndex})`,
      [...legacyValues, actualUserId],
    );
  }

  if (profileFields.length > 0) {
    await dbPool.query(`INSERT INTO "user_profiles" ("user_id") VALUES ($1) ON CONFLICT ("user_id") DO NOTHING`, [actualUserId]);
    await dbPool.query(
      `UPDATE "user_profiles"
       SET ${profileFields.join(", ")}
       WHERE "user_id" = $${profileIndex}`,
      [...profileValues, actualUserId],
    );
  }

  return true;
};

const loadNameHistory = async (profileId: string) => {
  try {
    const result = await dbPool.query(
      `SELECT topic, username
       FROM names
       WHERE iduser = $1 OR username = $1
       ORDER BY id DESC
       LIMIT 30`,
      [profileId],
    );
    return result.rows;
  } catch (error) {
    console.warn("[ProfileHistory] names table lookup failed:", error);
    return [];
  }
};

export function registerProfileHandlers(io: SocketIOServer, socket: Socket) {
  const userId = socket.data?.user?.id;

  socket.on("profile:view", async (data: { profileId: string; hidden?: boolean }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });

      const requestedProfileId = normalizeId(data?.profileId);
      if (!requestedProfileId) return callback?.({ error: "Profile not found" });

      let profile = await ProfileService.getFullProfile(requestedProfileId);

      if (!profile) {
        const allSockets = await io.fetchSockets();
        const targetSocket = allSockets.find(s => {
          const uid = String(s.data?.user?.id || "").trim().toLowerCase();
          return uid === requestedProfileId.toLowerCase();
        });
        if (targetSocket?.data?.user) {
          const su = targetSocket.data.user;
          profile = {
            id: su.id,
            username: su.username,
            displayName: su.displayName || su.username,
            role: su.role,
            avatarUrl: su.avatar || "/pic.png",
            coverUrl: "/pich.png",
            countryCode: su.countryCode || "SA",
            presence: su.status || "online",
            createdAt: su.connectedAt || new Date().toISOString(),
            updatedAt: su.connectedAt || new Date().toISOString(),
            profile: null,
          };
        }
      }

      if (!profile) return callback?.({ error: "Profile not found" });

      const resolvedProfileId = normalizeId(profile.id || requestedProfileId);
      const isHiddenVisit = Boolean(data.hidden && (await canRunAdminAction(socket, userId, "history")));
      await ProfileService.recordVisit(userId, resolvedProfileId, isHiddenVisit);

      const onlineTarget = await findOnlineUser(resolvedProfileId, profile.username);
      const stats = await ProfileService.getProfileStats(resolvedProfileId);
      const relationship = await ProfileService.getRelationship(userId, resolvedProfileId);
      const canSeeVisitors = relationship.isSelf || (await canRunAdminAction(socket, userId, "history"));
      const visitors = canSeeVisitors ? ProfileService.getVisitors(resolvedProfileId) : [];

      const hydratedProfile = {
        ...profile,
        presence: onlineTarget?.status || profile.presence || "online",
        countryCode: onlineTarget?.countryCode || profile.countryCode || "SA",
        connectedAt: onlineTarget?.connectedAt || null,
        roomId: onlineTarget?.roomId || profile.profile?.roomId || "",
      };

      if (userId !== resolvedProfileId && !isHiddenVisit) {
        io.to(`user:${resolvedProfileId}`).emit("profile:viewed", {
          visitorId: userId,
          timestamp: Date.now(),
        });
      }

      callback?.({ success: true, profile: hydratedProfile, stats, relationship, visitors });
    } catch (err) {
      console.error("[ProfileView] Error:", err);
      callback?.({ error: "Failed to view profile" });
    }
  });

  socket.on("profile:visitors", async (data: { profileId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      const profileId = normalizeId(data?.profileId);
      const relationship = ProfileService.getRelationship(userId, profileId);
      if (!relationship.isSelf && !(await canRunAdminAction(socket, userId, "history"))) {
        return callback?.({ error: "Permission denied" });
      }
      callback?.({ success: true, visitors: ProfileService.getVisitors(profileId) });
    } catch (err) {
      console.error("[ProfileVisitors] Error:", err);
      callback?.({ error: "Failed to load visitors" });
    }
  });

  socket.on("profile:adminUpdate", async (data: { profileId: string; updates: any }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const { profileId, updates } = data;
      await db.update(userProfiles).set(updates).where(eq(userProfiles.userId, profileId));

      io.to(`user:${profileId}`).emit("profile:updated", updates);
      io.emit("user_profile_updated", { userId: profileId, ...updates });
      callback?.({ success: true });
    } catch (err) {
      console.error("[ProfileAdminUpdate] Error:", err);
      callback?.({ error: "Failed to update profile" });
    }
  });

  socket.on("profile:adminAction", async (data: { profileId: string; action: AdminAction; value?: any; reason?: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });

      const profileId = normalizeId(data?.profileId);
      const action = data?.action;
      if (!profileId || !action) return callback?.({ error: "Invalid action" });
      if (!(await canRunAdminAction(socket, userId, action))) return callback?.({ error: "Permission denied" });

      const targetProfile = await ProfileService.getFullProfile(profileId);
      if (!targetProfile) return callback?.({ error: "Profile not found" });
      const target = await findOnlineUser(targetProfile.id, targetProfile.username);

      if (["kick", "ban", "room_kick", "room_mute", "global_mute", "pull_to_room"].includes(action)) {
        if (String(targetProfile.id || profileId) === String(userId)) {
          return callback?.({ error: "Cannot perform this action on yourself" });
        }
        const powerAction: PowerAction = action === "ban" ? "ban" : (action === "room_mute" || action === "global_mute") ? "mute" : "kick";
        const targetRole = String(target?.role || targetProfile.role || "guest");
        if (!canExecuteAction(String(socket.data.user?.role || "guest"), targetRole, powerAction)) {
          return callback?.({ error: action === "pull_to_room" ? "العضو يملك ترقية اكبر منك لا تستطيع تنفيذ الامر" : "Permission denied" });
        }
      }

      let updates: Record<string, unknown> = {};
      let responsePayload: Record<string, unknown> = {};

      if (action === "nick") updates = { topic: data.value };
      if (action === "message") updates = { msg: data.value };
      if (action === "likes") updates = { wall_post_likes: data.value };
      if (action === "site_badge") updates = { site_badge: data.value };
      if (action === "power") {
        if (String(targetProfile.id || profileId) === String(userId)) {
          return callback?.({ error: "لا يمكنك تعديل أو ترقية رتبتك بنفسك" });
        }

        const assignRes = await assignUserRole({
          actorId: userId,
          targetUserId: targetProfile.id || profileId,
          roleIdentifier: data.value ? String(data.value).trim() : "",
          startDate: (data as any).startDate,
          endDate: (data as any).endDate,
        });

        if (!assignRes.success) {
          return callback?.({ error: assignRes.error || "تعذر إسناد الرتبة" });
        }

        const newPowerValue = data.value ? String(data.value).trim() : "";
        const roleDisplayName = assignRes.roleName || (data as any).displayName || newPowerValue || "عضو";
        const canonicalRole = assignRes.canonicalRole || (newPowerValue ? "admin" : "member");
        const adminName = socket.data.user?.username || "الإدارة";
        const adminAvatar = socket.data.user?.avatar || "/pic.png";

        // إبطال كاش الصلاحيات فوراً وجلب الصلاحيات المحدثة
        await invalidatePermissionCache(targetProfile.id || profileId);
        const userContext = await getUserContext(targetProfile.id || profileId);
        const permissionsList = Array.from(userContext.permissions);

        // توليد توكن مصادقة جديد محدث بالرتبة الجديدة لتفادي الحاجة لتسجيل الخروج
        const freshToken = issueToken({
          id: targetProfile.id || profileId,
          username: targetProfile.username,
          role: canonicalRole,
        });

        // تحديث الرتبة في الذاكرة اللحظية للحضور (presence)
        await updateUserRolePresence(profileId, canonicalRole, assignRes.iconUrl || "");

        const alertPayload = {
          alertId: String(Date.now()),
          fromUserId: userId,
          fromUsername: adminName,
          fromAvatar: adminAvatar,
          fromBanner: (socket.data.user as any)?.giftedBannerUrl || "",
          fromGiftIcon: (socket.data.user as any)?.giftedGiftIconUrl || "",
          fromPromotionIcon: (socket.data.user as any)?.roleIconUrl || (socket.data.user as any)?.giftedPromotionIconUrl || "",
          fromAvatarFrame: socket.data.user?.avatarFrameUrl || "",
          message: newPowerValue ? `تم رفع ترقيتك إلى ${roleDisplayName}` : "تم إزالة ترقيتك وإعادتك كعضو عادي",
          timestamp: Date.now(),
        };
        io.to(`user:${profileId}`).emit("alert_received", alertPayload);

        // تحديث role والأيقونة والصلاحيات فوراً على جميع سوكيتات العضو المتصلة
        const targetId = normalizeId(profileId).toLowerCase();
        const targetName = normalizeId(targetProfile.username).toLowerCase();
        for (const [, s] of io.sockets.sockets) {
          const ud = s.data?.user;
          if (!ud) continue;
          const sid = normalizeId(ud.id).toLowerCase();
          const sname = normalizeId(ud.username).toLowerCase();
          if (sid === targetId || sname === targetName) {
            s.data.user.role = canonicalRole;
            s.data.user.power = newPowerValue;
            if (assignRes.iconUrl) {
              (s.data.user as any).roleIconUrl = assignRes.iconUrl;
            } else if (!newPowerValue) {
              (s.data.user as any).roleIconUrl = "";
            }

            // تحديث غرفة تنبيهات المشرفين فوراً
            if (canonicalRole === "admin" || canonicalRole === "owner") {
              s.join("moderators_alerts");
            } else {
              s.leave("moderators_alerts");
            }

            s.emit("role:updated", {
              role: canonicalRole,
              roleName: roleDisplayName,
              roleIconUrl: assignRes.iconUrl || "",
              power: newPowerValue,
              token: freshToken,
              permissions: permissionsList,
              rank: assignRes.rank || 1000,
            });
          }
        }

        const noticeText = newPowerValue
          ? `تم تغيير ترقية العضو إلى ${roleDisplayName}`
          : "تم إزالة الترقية بنجاح";

        io.to(`user:${profileId}`).emit("profile:updated", {
          power: newPowerValue,
          role: canonicalRole,
          roleIconUrl: assignRes.iconUrl || "",
        });

        io.emit("user_profile_updated", {
          userId: profileId,
          username: targetProfile.username,
          role: canonicalRole,
          roleName: roleDisplayName,
          power: newPowerValue,
          roleIconUrl: assignRes.iconUrl || "",
        });

        return callback?.({
          success: true,
          notice: noticeText,
          role: roleDisplayName,
          iconUrl: assignRes.iconUrl || "",
        });
      }
      if (action === "delete_pic") updates = { pic: "pic.png" };
      if (action === "room_mute" || action === "global_mute") updates = { muted: 1 };
      if (action === "room_unmute") updates = { muted: 0 };
      if (action === "history") {
        responsePayload.history = await loadNameHistory(profileId);
      }

      if (Object.keys(updates).length > 0) {
        await applyLegacyProfileUpdate(profileId, updates);
      }

      

      // تحديث حالة الإسكات على الـ socket للمستخدم المستهدف وإرسال إشعار
      if (action === "room_mute" || action === "global_mute" || action === "room_unmute") {
        const isMuted = action === "room_mute" || action === "global_mute";
        
        // تحديث حالة الكتم لكافة السوكيتات النشطة للعضو
        const targetId = normalizeId(profileId).toLowerCase();
        const targetName = normalizeId(targetProfile.username).toLowerCase();
        for (const [, s] of io.sockets.sockets) {
          const ud = s.data?.user;
          if (!ud) continue;
          const sid = normalizeId(ud.id).toLowerCase();
          const sname = normalizeId(ud.username).toLowerCase();
          if (sid === targetId || sname === targetName) {
            (s.data.user as any).muted = isMuted;
            s.emit("muted_state", { muted: isMuted });
          }
        }

        // إرسال تنبيه ديالوج للعضو المستهدف عند الإسكات العام
        if (action === "global_mute" && isMuted) {
          const adminName = socket.data.user?.username || "الإدارة";
          const adminAvatar = socket.data.user?.avatar || "/pic.png";
          const alertPayload = {
            alertId: String(Date.now()),
            fromUserId: userId,
            fromUsername: adminName,
            fromAvatar: adminAvatar,
            fromBanner: (socket.data.user as any).giftedBannerUrl || "",
            fromGiftIcon: (socket.data.user as any).giftedGiftIconUrl || "",
            fromPromotionIcon: (socket.data.user as any).roleIconUrl || (socket.data.user as any).giftedPromotionIconUrl || "",
            fromAvatarFrame: socket.data.user?.avatarFrameUrl || "",
            message: "تم منعك من الحديث في الدردشة",
            timestamp: Date.now(),
          };
          io.to(`user:${profileId}`).emit("alert_received", alertPayload);
        }

        // إرسال تنبيه ديالوج للعضو المستهدف عند إلغاء الإسكات
        if (action === "room_unmute") {
          const adminName = socket.data.user?.username || "الإدارة";
          const adminAvatar = socket.data.user?.avatar || "/pic.png";
          const alertPayload = {
            alertId: String(Date.now()),
            fromUserId: userId,
            fromUsername: adminName,
            fromAvatar: adminAvatar,
            fromBanner: (socket.data.user as any).giftedBannerUrl || "",
            fromGiftIcon: (socket.data.user as any).giftedGiftIconUrl || "",
            fromPromotionIcon: (socket.data.user as any).roleIconUrl || (socket.data.user as any).giftedPromotionIconUrl || "",
            fromAvatarFrame: socket.data.user?.avatarFrameUrl || "",
            message: "تم السماح لك بالدردشة",
            timestamp: Date.now(),
          };
          io.to(`user:${profileId}`).emit("alert_received", alertPayload);
        }

        responsePayload.notice = isMuted ? "تم تنفيذ الاسكات العام" : "تم الغاء الاسكات العام";
      }

      if (target && (action === "kick" || action === "ban")) {
        const adminName = socket.data.user?.username || "الإدارة";
        const adminAvatar = socket.data.user?.avatar || "/pic.png";
        const msg = data.reason || (action === "ban" ? "تم حظرك من الموقع" : "تم طردك من الموقع");
        // إرسال تنبيه مرئي
        io.to(`user:${profileId}`).emit("alert_received", {
          alertId: String(Date.now()),
          fromUserId: userId,
          fromUsername: adminName,
          fromAvatar: adminAvatar,
          fromBanner: (socket.data.user as any).giftedBannerUrl || "",
          fromGiftIcon: (socket.data.user as any).giftedGiftIconUrl || "",
          fromPromotionIcon: (socket.data.user as any).roleIconUrl || (socket.data.user as any).giftedPromotionIconUrl || "",
          fromAvatarFrame: socket.data.user?.avatarFrameUrl || "",
          message: msg,
          timestamp: Date.now(),
        });
        // إرسال أمر تسجيل الخروج للسوكيت المستهدف
        io.to(target.socketId).emit("force_logout", { message: msg });
      }

      if (action === "room_kick") {
        console.log("========== [KICK_TRACE] ENTERED room_kick handler ==========");
        console.log("[KICK_TRACE] action=room_kick value=", data.value, "reason=", data.reason);
        console.log("[KICK_TRACE] adminUser=", socket.data.user?.username, "adminRole=", socket.data.user?.role);
        // اكتشاف الغرفة: أولاً من target، وإذا لم يُعثر عليها نبحث مباشرة في سوكيتات السيرفر
        let kickTargetRoomId = target?.roomId || "";
        const targetIdLow = normalizeId(targetProfile.id).toLowerCase();
        const targetNameLow = normalizeId(targetProfile.username).toLowerCase();

        console.log("[KICK_DIAG] target:", JSON.stringify({ roomId: target?.roomId, socketId: target?.socketId }));
        console.log("[KICK_DIAG] targetProfile:", JSON.stringify({ id: targetProfile.id, username: targetProfile.username, idreg: targetProfile.idreg }));
        console.log("[KICK_DIAG] targetIdentity:", JSON.stringify({ targetIdLow, targetNameLow, adminUser: socket.data.user?.username, adminId: socket.data.user?.id }));

        if (!kickTargetRoomId) {
          for (const [, s] of io.sockets.sockets) {
            const ud = s.data?.user;
            if (!ud) continue;
            const sid = normalizeId(ud.id).toLowerCase();
            const sname = normalizeId(ud.username).toLowerCase();
            if (sid === targetIdLow || sname === targetNameLow) {
              // استخراج الغرفة مباشرة من s.rooms
              for (const rm of s.rooms) {
                if (rm.startsWith("room:")) {
                  kickTargetRoomId = rm.substring(5);
                  break;
                }
              }
              if (kickTargetRoomId) break;
            }
          }
        }

        console.log("[KICK_DIAG] kickTargetRoomId:", kickTargetRoomId);

        if (!kickTargetRoomId) {
          return callback?.({ error: "العضو ليس متواجداً في أي غرفة حالياً" });
        }

        const minutes = Number(data.value) || 15;
        const bannedUntil = new Date(Date.now() + minutes * 60 * 1000);
        const { resolveRoomId, resolveRoomIdVariants, normalizeRoomIdValue } = await import("./roomAccess");
        const resolvedRoomId = await resolveRoomId(kickTargetRoomId);
        console.log("[KICK_TRACE_ROOM] kickTargetRoomId=", kickTargetRoomId, "resolvedRoomId=", resolvedRoomId, "same=", kickTargetRoomId === resolvedRoomId);
        const roomIdVariants = await resolveRoomIdVariants(kickTargetRoomId);
        // Also include any exact room ids observed on the target's sockets
        const observedRoomIds = new Set<string>();
        for (const [, s] of io.sockets.sockets) {
          const ud = s.data?.user;
          if (!ud) continue;
          const sid = normalizeId(ud.id).toLowerCase();
          const sname = normalizeId(ud.username).toLowerCase();
          if (sid === targetIdLow || sname === targetNameLow) {
            for (const rm of s.rooms) {
              if (!rm) continue;
              if (rm.startsWith("room:")) {
                const val = rm.substring(5);
                observedRoomIds.add(val);
                observedRoomIds.add(rm);
              } else {
                observedRoomIds.add(rm);
              }
            }
          }
        }

        const roomVariants = Array.from(new Set([
          resolvedRoomId,
          kickTargetRoomId,
          ...roomIdVariants,
          ...Array.from(observedRoomIds.values()),
          normalizeRoomIdValue(kickTargetRoomId),
          normalizeRoomIdValue(resolvedRoomId),
        ].filter(Boolean)));
        console.log("[KICK_DIAG] resolvedRoomId=", resolvedRoomId, "roomIdVariants=", JSON.stringify(roomIdVariants), "roomVariants=", JSON.stringify(roomVariants));

        // جلب الهوية الصحيحة للمستخدم من قاعدة البيانات
        // وتسجيل الطرد عبر أكثر من معرف ممكن لضمان فحص join_room لاحقاً
        let dbUserId = targetProfile.id;
        let resolvedIdentifiers: string[] = [];
        let userLookup: any = null;
        try {
          userLookup = await dbPool.query(
            `SELECT CAST(id AS text) as id, CAST(uid AS text) as uid, CAST(idreg AS varchar) as idreg, username
             FROM users
             WHERE CAST(id AS text) = $1
                OR CAST(uid AS text) = $2
                OR CAST(idreg AS varchar) = $3
                OR lower(username) = lower($4)
             ORDER BY CASE WHEN CAST(id AS text) = $1 THEN 0 ELSE 1 END
             LIMIT 1`,
            [String(targetProfile.id || ""), String(targetProfile.id || ""), String(targetProfile.id || ""), String(targetProfile.username || "")]
          );
          if (userLookup.rows[0]?.id) dbUserId = userLookup.rows[0].id;

          const row = userLookup.rows[0];
          const candidateValues = [
            String(dbUserId || ""),
            String(targetProfile.id || ""),
            String(targetProfile.username || ""),
            String(targetProfile.idreg || ""),
            String(row?.uid || ""),
            String(row?.idreg || ""),
            String(row?.username || ""),
          ];
          resolvedIdentifiers = Array.from(new Set(candidateValues.filter((value) => String(value).trim())));
        } catch (_) {
          resolvedIdentifiers = Array.from(new Set([
            String(dbUserId || ""),
            String(targetProfile.id || ""),
            String(targetProfile.username || ""),
            String(targetProfile.idreg || ""),
          ].filter((value) => String(value).trim())));
        }

        console.log("[KICK_DIAG] userLookup", JSON.stringify({ rowCount: userLookup?.rowCount || 0, row: userLookup?.rows?.[0] || null, dbUserId, resolvedIdentifiers }));
        console.log("[KICK_DIAG] inserting kick for", JSON.stringify({ roomVariants, identifiers: resolvedIdentifiers, bannedUntil: bannedUntil.toISOString(), minutes }));
        const insertResults = await Promise.all(
          roomVariants.flatMap((roomVariant) =>
            resolvedIdentifiers.map((identifier) =>
              dbPool.query(
                `INSERT INTO room_kicks (room_id, user_id, banned_until) VALUES ($1, $2, $3)`,
                [roomVariant, identifier, bannedUntil]
              )
            )
          )
        );
        console.log("[KICK_DIAG] insert results", insertResults.map((result) => ({ rowCount: result.rowCount })));

        try {
          const verifyRes = await dbPool.query(
            `SELECT room_id, user_id, banned_until, created_at
             FROM room_kicks
             WHERE room_id = ANY($1::text[])
               AND (
                 user_id = ANY($2::text[])
                 OR lower(user_id) = ANY($3::text[])
               )
             ORDER BY created_at DESC
             LIMIT 50`,
            [roomVariants, resolvedIdentifiers, resolvedIdentifiers.map((v) => v.toLowerCase())]
          );
          console.log("[KICK_DIAG] verify inserted rows count=", verifyRes.rowCount);
          if (verifyRes.rowCount > 0) console.log("[KICK_DIAG] verify rows:", JSON.stringify(verifyRes.rows));
        } catch (err) {
          console.error("[KICK_DIAG] verify query failed:", err);
        }
        // فصل كافة سوكيتات العضو من الغرفة
        // الاعتماد فقط على s.rooms.has() لأنه المصدر الموثوق الوحيد لعضوية الغرفة
        const { leaveRoom, getRoomMemberCount } = await import("./presenceManager");
        const { publishSocketEvent, publishGlobalEvent } = await import("./SocketBroker");

        let kicked = false;
        for (const [, s] of io.sockets.sockets) {
          const ud = s.data?.user;
          if (!ud) continue;
          const sid = normalizeId(ud.id).toLowerCase();
          const sname = normalizeId(ud.username).toLowerCase();

          // التحقق من هوية العضو
          const isTarget = sid === targetIdLow || sname === targetNameLow;
          console.log(`[KICK_DIAG] socket: sid=${sid} sname=${sname} isTarget=${isTarget} s.rooms=${JSON.stringify(Array.from(s.rooms))}`);
          if (!isTarget) continue;

          // التحقق من وجوده بالغرفة عبر s.rooms مباشرةً (الأكثر موثوقية)
          const hasCanonicalRoom = s.rooms.has(`room:${resolvedRoomId}`);
          const hasLegacyRoom = !hasCanonicalRoom && s.rooms.has(`room:${kickTargetRoomId}`);
          if (!hasCanonicalRoom && !hasLegacyRoom) {
            console.log(`[KICK_DIAG] NOT in room. looking for room:${kickTargetRoomId} canonical:${resolvedRoomId}`);
            continue;
          }

          kicked = true;

          // علامة تمنع إرسال رسالة "غادر الغرفة" عند طرد العضو
          s.data.kicked = true;

          // إبلاغ العضو المستهدف بالطرد
          s.emit("room_kicked", {
            roomId: kickTargetRoomId,
            duration: minutes,
            message: `تم طردك من الغرفة مؤقتاً لمدة ${minutes} دقائق`
          });

          // تنفيذ الخروج الفعلي من الغرفة
          try {
            console.log(`[KICK_DIAG] before leave s.id=${s.id} s.rooms=${JSON.stringify(Array.from(s.rooms))}`);
          } catch (err) {
            console.warn('[KICK_DIAG] failed to stringify s.rooms before leave', err);
          }
          s.leave(`room:${resolvedRoomId}`);
          s.leave(`room:${kickTargetRoomId}`);
          try {
            const post = await io.in(`room:${kickTargetRoomId}`).fetchSockets();
            console.log(`[KICK_DIAG] after leave room=${kickTargetRoomId} sockets=${post.length} ids=${JSON.stringify(post.map(p=>p.id))}`);
          } catch (err) {
            console.warn('[KICK_DIAG] failed to fetch sockets after leave:', err);
          }
          await leaveRoom(s.id);
          s.data.user.roomId = "";

          const memberCount = await getRoomMemberCount(kickTargetRoomId);
          await publishSocketEvent(kickTargetRoomId, "user_left", {
            socketId: s.id,
            username: s.data.user.username,
            roomId: kickTargetRoomId,
            memberCount,
          });

          const now = new Date().toISOString();
          console.log("[KICK_TRACE] About to publish system_message to room:", kickTargetRoomId, "text:", `تم طرد العضو (${s.data.user.username}) من الغرفة مؤقتاً لمدة ${minutes} دقائق`);
          await publishSocketEvent(kickTargetRoomId, "system_message", {
            text: `تم طرد العضو (${s.data.user.username}) من الغرفة مؤقتاً لمدة ${minutes} دقائق`,
            roomId: kickTargetRoomId,
            systemType: "leave",
            createdAt: now,
            user: {
              id: s.data.user.id,
              username: s.data.user.username,
              role: s.data.user.role,
              avatar: s.data.user.avatar,
              countryCode: s.data.user.countryCode,
              avatarFrameUrl: s.data.user.avatarFrameUrl,
              giftIconUrl: s.data.user.giftIconUrl,
            }
          });
          console.log("[KICK_TRACE] system_message sent successfully");

          await publishGlobalEvent("room_count_update", { roomId: kickTargetRoomId, memberCount });
          console.log("[KICK_TRACE] Kick complete for socket:", s.id, "username:", s.data.user.username);
        }

        responsePayload.notice = kicked
          ? `تم طرد العضو من الغرفة مؤقتاً لمدة ${minutes} دقائق`
          : `تم تسجيل الطرد وسيُطبَّق عند محاولة الدخول لمدة ${minutes} دقائق`;
      }

      if (target && action === "room_move") {
        io.to(target.socketId).emit("system_alert", {
          title: "نقل إلى غرفة",
          message: "طلبت الإدارة نقلك إلى غرفة أخرى.",
          from: socket.data.user?.username,
        });
        responsePayload.notice = "تم إرسال طلب النقل للعضو المتصل";
      }

      if (target && action === "pull_to_room") {
        const targetRoomId = normalizeId(data?.value);
        if (!targetRoomId) return callback?.({ error: "معرف الغرفة مطلوب" });

        // بحث عن اسم الغرفة
        let roomName = targetRoomId;
        try {
          const allRooms = await listRooms();
          const found = allRooms.find(r => r.id === targetRoomId || (r as any).slug === targetRoomId);
          if (found) roomName = found.name;
        } catch (_) {}

        // إرسال تنبيه للعضو المستهدف
        const adminName = socket.data.user?.username || "الإدارة";
        const adminAvatar = socket.data.user?.avatar || "/pic.png";
        io.to(`user:${profileId}`).emit("alert_received", {
          alertId: String(Date.now()),
          fromUserId: userId,
          fromUsername: adminName,
          fromAvatar: adminAvatar,
          fromBanner: (socket.data.user as any).giftedBannerUrl || "",
          fromGiftIcon: (socket.data.user as any).giftedGiftIconUrl || "",
          fromPromotionIcon: (socket.data.user as any).roleIconUrl || (socket.data.user as any).giftedPromotionIconUrl || "",
          fromAvatarFrame: socket.data.user?.avatarFrameUrl || "",
          message: `تم نقلك إلى الغرفة ${roomName}`,
          timestamp: Date.now(),
        });

        io.to(target.socketId).emit("force_join_room", {
          roomId: targetRoomId,
          from: adminName,
        });
        responsePayload.notice = "تم سحب العضو إلى الغرفة";
      }

      await logModerationEvent({
        actorId: userId,
        targetUserId: targetProfile.id || profileId,
        eventType: `profile.${action}`,
        reason: data.reason || "",
        metadata: { value: data.value },
      });

      const newDisplayName = action === "nick" && data.value ? String(data.value).trim().slice(0, 120) : targetProfile.username;
      io.emit("user_profile_updated", {
        userId: targetProfile.id || profileId,
        username: newDisplayName,
        previousUsername: targetProfile.username,
        avatar: updates.pic ? "/pic.png" : undefined,
        avatarUrl: updates.pic ? "/pic.png" : undefined,
        profileMsg: updates.msg,
        statusMsg: updates.msg || "",
        siteBadge: updates.site_badge,
      });

      // Update target's connected socket data so subsequent get_online_users uses the new name
      if (action === "nick" && target?.socketId) {
        try {
          const { getIO: getIO2 } = await import("./index");
          const io2 = getIO2();
          const targetSocket = io2?.sockets?.sockets?.get(target.socketId);
          if (targetSocket?.data?.user) {
            targetSocket.data.user.username = newDisplayName;
          }
        } catch (e) {
          console.error("[ProfileAdminAction] Failed to update target socket username:", e);
        }
      }

      callback?.({ success: true, ...responsePayload });
    } catch (err) {
      console.error("[ProfileAdminAction] Error:", err);
      callback?.({ error: "Failed to execute action" });
    }
  });

  socket.on("profile:follow", async (data: { profileId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });

      const profileId = normalizeId(data?.profileId);
      if (!profileId) return callback?.({ error: "Profile not found" });

      const result = await ProfileService.toggleFollow(userId, profileId);
      if (result.error) return callback?.({ error: result.error });

      if (String(profileId) !== String(userId)) {
        if (result.following) {
          createNotification(profileId, userId, "follow", "user", userId, {}).catch(() => {});
        } else {
          createNotification(profileId, userId, "unfollow", "user", userId, {}).catch(() => {});
        }
      }

      io.to(`user:${profileId}`).emit("user:followed", {
        followerId: userId,
        following: result.following,
      });

      callback?.({ success: true, following: result.following, followerCount: result.followerCount });
    } catch (err) {
      console.error("[ProfileFollow] Error:", err);
      callback?.({ error: "Failed to follow" });
    }
  });

  socket.on("profile:like", async (data: { profileId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });

      const profileId = normalizeId(data?.profileId);
      if (!profileId) return callback?.({ error: "Profile not found" });

      const result = await ProfileService.addLike(userId, profileId);
      if (result.error) return callback?.({ error: result.error });

      if (String(profileId) !== String(userId)) {
        createNotification(profileId, userId, "like", "user", userId, {}).catch(() => {});
      }

      io.to(`user:${profileId}`).emit("profile:liked", {
        likerId: userId,
        likesCount: result.likesCount,
      });

      callback?.({ success: true, likesCount: result.likesCount });
    } catch (err) {
      console.error("[ProfileLike] Error:", err);
      callback?.({ error: "Failed to like" });
    }
  });

  socket.on("profile:sendAlert", async (data: { profileId: string; message: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });

      const profileId = normalizeId(data?.profileId);
      const message = String(data?.message || "").trim();
      if (!profileId) return callback?.({ error: "Profile not found" });
      if (!message) return callback?.({ error: "الرسالة مطلوبة" });
      if (message.length > 500) return callback?.({ error: "الرسالة طويلة جداً" });
      if (String(profileId) === String(userId)) return callback?.({ error: "لا يمكنك إرسال تنبيه لنفسك" });

      let senderName = "عضو";
      let senderAvatar = "/pic.png";
      let senderBanner = "";
      let senderGiftIcon = "";
      let senderPromotionIcon = "";
      let senderAvatarFrame = "";
      try {
        const senderRes = await dbPool.query(
          `SELECT u.username, u.topic, u.pic, u.cover,
                  up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url, up.avatar_frame_url
           FROM users u
           LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
           WHERE CAST(u.id AS TEXT) = $1 OR CAST(u.uid AS TEXT) = $1 LIMIT 1`,
          [String(userId)]
        );
        if (senderRes.rows.length > 0) {
          const sender = senderRes.rows[0];
          senderName = sender.topic || sender.username || "عضو";
          senderAvatar = sender.pic || "/pic.png";
          senderBanner = sender.gifted_banner_url || "";
          senderGiftIcon = sender.gifted_gift_icon_url || "";
          senderPromotionIcon = sender.gifted_promotion_icon_url || "";
          senderAvatarFrame = sender.avatar_frame_url || "";
        }
      } catch {}

      io.to(`user:${profileId}`).emit("alert_received", {
        alertId: String(Date.now()),
        fromUserId: userId,
        fromUsername: senderName,
        fromAvatar: senderAvatar,
        fromBanner: senderBanner,
        fromGiftIcon: senderGiftIcon,
        fromPromotionIcon: senderPromotionIcon,
        fromAvatarFrame: senderAvatarFrame,
        message,
        timestamp: Date.now(),
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[ProfileSendAlert] Error:", err);
      callback?.({ error: "Failed to send alert" });
    }
  });

  /**
   * إهداء بنر (أيقونة قبل الاسم) لعضو آخر
   */
  socket.on("profile:gift_banner", async (data: { profileId: string; iconUrl: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const profileId = normalizeId(data?.profileId);
      const iconUrl = String(data?.iconUrl || "").trim();
      if (!profileId) return callback?.({ error: "Profile not found" });

      // تأكد من أن الأيقونة موجودة في جدول swiper_banners أو icons
      if (iconUrl) {
        const iconCheck = await dbPool.query(
          `SELECT id FROM swiper_banners WHERE image_url = $1 UNION ALL SELECT id FROM icons WHERE image_url = $1`,
          [iconUrl]
        );
        if (iconCheck.rows.length === 0) return callback?.({ error: "Icon not found in catalog" });
      }

      // تحديث في قاعدة البيانات
      await dbPool.query(
        `INSERT INTO user_profiles (user_id, gifted_banner_url) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET gifted_banner_url = $2`,
        [profileId, iconUrl]
      );

      // تحديث في الذاكرة
      const targetUser = await findOnlineUser(profileId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          (targetSocket.data.user as any).giftedBannerUrl = iconUrl;
        }
      }

      // إرسال إشعار للمستلم
      io.to(`user:${profileId}`).emit("gift_banner_received", {
        fromUserId: userId,
        fromUsername: socket.data.user?.username || "",
        iconUrl,
      });

      // بث التحديث لجميع المتصلين
      io.emit("user_profile_updated", {
        userId: profileId,
        giftedBannerUrl: iconUrl,
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[GiftBanner] Error:", err);
      callback?.({ error: "Failed to gift banner" });
    }
  });

  /**
   * إزالة بنر من عضو
   */
  socket.on("profile:remove_banner", async (data: { profileId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const profileId = normalizeId(data?.profileId);
      if (!profileId) return callback?.({ error: "Profile not found" });

      await dbPool.query(
        `INSERT INTO user_profiles (user_id, gifted_banner_url) VALUES ($1, '') ON CONFLICT (user_id) DO UPDATE SET gifted_banner_url = ''`,
        [profileId]
      );

      const targetUser = await findOnlineUser(profileId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          (targetSocket.data.user as any).giftedBannerUrl = "";
        }
      }

      io.to(`user:${profileId}`).emit("gift_banner_received", {
        fromUserId: userId,
        fromUsername: socket.data.user?.username || "",
        iconUrl: "",
      });

      io.emit("user_profile_updated", {
        userId: profileId,
        giftedBannerUrl: "",
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[RemoveBanner] Error:", err);
      callback?.({ error: "Failed to remove banner" });
    }
  });

  /**
   * إهداء أيقونة هدية لعضو
   */
  socket.on("profile:gift_gift_icon", async (data: { profileId: string; iconUrl: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const profileId = normalizeId(data?.profileId);
      const iconUrl = String(data?.iconUrl || "").trim();
      if (!profileId) return callback?.({ error: "Profile not found" });

      if (iconUrl) {
        const iconCheck = await dbPool.query(`SELECT id FROM icons WHERE image_url = $1`, [iconUrl]);
        if (iconCheck.rows.length === 0) return callback?.({ error: "Icon not found in catalog" });
      }

      await dbPool.query(
        `INSERT INTO user_profiles (user_id, gifted_gift_icon_url) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET gifted_gift_icon_url = $2`,
        [profileId, iconUrl]
      );

      const targetUser = await findOnlineUser(profileId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          (targetSocket.data.user as any).giftedGiftIconUrl = iconUrl;
        }
      }

      io.to(`user:${profileId}`).emit("gift_icon_received", {
        fromUserId: userId,
        fromUsername: socket.data.user?.username || "",
        iconUrl,
      });

      io.emit("user_profile_updated", {
        userId: profileId,
        giftedGiftIconUrl: iconUrl,
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[GiftIcon] Error:", err);
      callback?.({ error: "Failed to gift icon" });
    }
  });

  /**
   * إزالة أيقونة هدية من عضو
   */
  socket.on("profile:remove_gift_icon", async (data: { profileId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const profileId = normalizeId(data?.profileId);
      if (!profileId) return callback?.({ error: "Profile not found" });

      await dbPool.query(
        `INSERT INTO user_profiles (user_id, gifted_gift_icon_url) VALUES ($1, '') ON CONFLICT (user_id) DO UPDATE SET gifted_gift_icon_url = ''`,
        [profileId]
      );

      const targetUser = await findOnlineUser(profileId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          (targetSocket.data.user as any).giftedGiftIconUrl = "";
        }
      }

      io.to(`user:${profileId}`).emit("gift_icon_received", {
        fromUserId: userId,
        fromUsername: socket.data.user?.username || "",
        iconUrl: "",
      });

      io.emit("user_profile_updated", {
        userId: profileId,
        giftedGiftIconUrl: "",
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[RemoveGiftIcon] Error:", err);
      callback?.({ error: "Failed to remove gift icon" });
    }
  });

  /**
   * إهداء أيقونة ترقية لعضو
   */
  socket.on("profile:gift_promotion_icon", async (data: { profileId: string; iconUrl: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const profileId = normalizeId(data?.profileId);
      const iconUrl = String(data?.iconUrl || "").trim();
      if (!profileId) return callback?.({ error: "Profile not found" });

      if (iconUrl) {
        const iconCheck = await dbPool.query(`SELECT id FROM icons WHERE image_url = $1`, [iconUrl]);
        if (iconCheck.rows.length === 0) return callback?.({ error: "Icon not found in catalog" });
      }

      await dbPool.query(
        `INSERT INTO user_profiles (user_id, gifted_promotion_icon_url) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET gifted_promotion_icon_url = $2`,
        [profileId, iconUrl]
      );

      const targetUser = await findOnlineUser(profileId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          (targetSocket.data.user as any).giftedPromotionIconUrl = iconUrl;
        }
      }

      io.to(`user:${profileId}`).emit("gift_promotion_icon_received", {
        fromUserId: userId,
        fromUsername: socket.data.user?.username || "",
        iconUrl,
      });

      io.emit("user_profile_updated", {
        userId: profileId,
        giftedPromotionIconUrl: iconUrl,
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[GiftPromotionIcon] Error:", err);
      callback?.({ error: "Failed to gift promotion icon" });
    }
  });

  /**
   * إزالة أيقونة ترقية من عضو
   */
  socket.on("profile:remove_promotion_icon", async (data: { profileId: string }, callback) => {
    try {
      if (!userId) return callback?.({ error: "Unauthorized" });
      if (!(await canRunAdminAction(socket, userId, "site_badge"))) return callback?.({ error: "Permission denied" });

      const profileId = normalizeId(data?.profileId);
      if (!profileId) return callback?.({ error: "Profile not found" });

      await dbPool.query(
        `INSERT INTO user_profiles (user_id, gifted_promotion_icon_url) VALUES ($1, '') ON CONFLICT (user_id) DO UPDATE SET gifted_promotion_icon_url = ''`,
        [profileId]
      );

      const targetUser = await findOnlineUser(profileId);
      if (targetUser) {
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          (targetSocket.data.user as any).giftedPromotionIconUrl = "";
        }
      }

      io.to(`user:${profileId}`).emit("gift_promotion_icon_received", {
        fromUserId: userId,
        fromUsername: socket.data.user?.username || "",
        iconUrl: "",
      });

      io.emit("user_profile_updated", {
        userId: profileId,
        giftedPromotionIconUrl: "",
      });

      callback?.({ success: true });
    } catch (err) {
      console.error("[RemovePromotionIcon] Error:", err);
      callback?.({ error: "Failed to remove promotion icon" });
    }
  });
}
