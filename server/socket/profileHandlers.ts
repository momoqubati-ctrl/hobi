import { Socket, Server as SocketIOServer } from "socket.io";
import { ProfileService } from "../services/profileService";
import { createNotification } from "../services/notificationService";
import { db, dbPool } from "../db";
import { userProfiles } from "../db/schema";
import { eq } from "drizzle-orm";
import { hasPermission, PermissionKey } from "../services/permissionEngine";
import { getAllOnlineUsers } from "./presenceManager";
import { canExecuteAction, logModerationEvent, PowerAction } from "../services/powersService";

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
  | "global_mute";

const ADMIN_ACTION_PERMISSION: Partial<Record<AdminAction, PermissionKey>> = {
  nick: "edituser",
  message: "edituser",
  likes: "ulike",
  site_badge: "edituser",
  power: "setpower",
  room_move: "loveu",
  history: "history",
  kick: "kick",
  delete_pic: "kick",
  ban: "ban",
  global_mute: "meiut",
};

const normalizeId = (value: unknown) => String(value || "").trim();

const canRunAdminAction = async (socket: Socket, userId: string, action: AdminAction) => {
  const role = String(socket.data.user?.role || "");
  if (role === "owner" || role === "admin") return true;

  if (action === "room_kick" || action === "room_mute" || action === "room_unmute") {
    return role === "moderator";
  }

  const permission = ADMIN_ACTION_PERMISSION[action];
  if (!permission) return false;

  try {
    return await hasPermission(userId, permission);
  } catch (error) {
    console.warn(`[ProfilePermissions] failed to check ${permission} for ${userId}:`, error);
    return false;
  }
};

const findOnlineUser = async (profileId: string, username?: string) => {
  const targetId = normalizeId(profileId).toLowerCase();
  const targetName = normalizeId(username).toLowerCase();
  const onlineUsers = await getAllOnlineUsers();

  return onlineUsers.find((user) => {
    const id = normalizeId(user.id).toLowerCase();
    const name = normalizeId(user.username).toLowerCase();
    return id === targetId || name === targetName || name === targetId;
  });
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
      const relationship = ProfileService.getRelationship(userId, resolvedProfileId);
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

      if (["kick", "ban", "room_kick", "room_mute"].includes(action)) {
        const powerAction: PowerAction = action === "ban" ? "ban" : action === "room_mute" ? "mute" : "kick";
        if (target && !canExecuteAction(String(socket.data.user?.role || "guest"), target.role, powerAction)) {
          return callback?.({ error: "Permission denied" });
        }
      }

      let updates: Record<string, unknown> = {};
      let responsePayload: Record<string, unknown> = {};

      if (action === "nick") updates = { topic: data.value };
      if (action === "message") updates = { msg: data.value };
      if (action === "likes") updates = { wall_post_likes: data.value };
      if (action === "site_badge") updates = { site_badge: data.value };
      if (action === "power") updates = { power: data.value };
      if (action === "delete_pic") updates = { pic: "pic.png" };
      if (action === "room_mute" || action === "global_mute") updates = { muted: 1 };
      if (action === "room_unmute") updates = { muted: 0 };
      if (action === "history") {
        responsePayload.history = await loadNameHistory(profileId);
      }

      if (Object.keys(updates).length > 0) {
        await applyLegacyProfileUpdate(profileId, updates);
      }

      if (target && (action === "kick" || action === "ban" || action === "room_kick")) {
        io.to(target.socketId).emit("system_alert", {
          title: action === "ban" ? "حظر" : "طرد",
          message: data.reason || (action === "ban" ? "تم حظرك من الموقع" : "تم طردك بواسطة الإدارة"),
          from: socket.data.user?.username,
        });
        io.sockets.sockets.get(target.socketId)?.disconnect(true);
      }

      if (target && action === "room_move") {
        io.to(target.socketId).emit("system_alert", {
          title: "نقل إلى غرفة",
          message: "طلبت الإدارة نقلك إلى غرفة أخرى.",
          from: socket.data.user?.username,
        });
        responsePayload.notice = "تم إرسال طلب النقل للعضو المتصل";
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

      if (result.following && String(profileId) !== String(userId)) {
        createNotification(profileId, userId, "follow", "user", userId, {}).catch(() => {});
      }

      io.to(`user:${profileId}`).emit("user:followed", {
        followerId: userId,
        following: result.following,
      });

      callback?.({ success: true, following: result.following });
    } catch (err) {
      console.error("[ProfileFollow] Error:", err);
      callback?.({ error: "Failed to follow" });
    }
  });
}
