/**
 * Presence Handlers
 * يدير أحداث الحضور والحالة للمستخدمين
 */
import type { Server, Socket } from "socket.io";
import {
  addConnectedUser,
  removeConnectedUser,
  getAllOnlineUsers,
  getTotalOnlineCount,
  getRoomMemberCount,
  pendingDisconnects,
} from "./presenceManager";
import { publishGlobalEvent } from "./SocketBroker";
import { updateCachedWallAuthorProfile } from "../services/wallService";
import { normalizeMinioUrl } from "../services/minioClient";
import { findInMemoryUser, updateInMemoryUserProfile } from "../services/authService";
import { dbPool } from "../db";
import { updatePersistedUserProfile } from "../services/userRepository";

export async function registerPresenceHandlers(io: Server, socket: Socket): Promise<void> {
  const user = socket.data.user;

  // تسجيل المستخدم عند الاتصال
  const inMemProfile = findInMemoryUser(user.id) || findInMemoryUser(user.username);
  const resolvedStatusMsg = (inMemProfile?.profile?.profileMsg || "").trim() || user.statusMsg || "";

  // Also try to enrich from DB for idreg + statusMsg using both modern and legacy sources
  let dbIdreg = user.idreg || "";
  let dbStatusMsg = resolvedStatusMsg;
  try {
    const profileResult = await dbPool.query(
      `SELECT "profile_msg", "idreg" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
      [user.id]
    );
    const profileRow = profileResult.rows[0];
    let legacyRow: any = null;
    if (!profileRow || !String(profileRow.profile_msg || "").trim()) {
      const legacyResult = await dbPool.query(`SELECT "msg", "idreg" FROM "users" WHERE "id" = $1 LIMIT 1`, [user.id]);
      legacyRow = legacyResult.rows[0];
    }

    if (profileRow && String(profileRow.profile_msg || "").trim()) {
      dbIdreg = (profileRow.idreg || "").toString().trim() || dbIdreg;
      dbStatusMsg = (profileRow.profile_msg || "").toString().trim() || dbStatusMsg;
    } else if (legacyRow) {
      dbIdreg = (legacyRow.idreg || "").toString().trim() || dbIdreg;
      dbStatusMsg = (legacyRow.msg || "").toString().trim() || dbStatusMsg;
    }
  } catch (_) {}

  addConnectedUser(socket.id, {
    id: user.id,
    username: user.username,
    role: user.role,
    avatar: user.avatar,
    countryCode: user.countryCode,
    avatarFrameUrl: user.avatarFrameUrl || "",
    giftIconUrl: user.giftIconUrl || "",
    messageBubbleStyle: user.messageBubbleStyle || "default",
    roomId: "",
    connectedAt: user.connectedAt,
    status: user.status || "online",
    idreg: dbIdreg,
    siteBadge: user.siteBadge || "",
    statusMsg: dbStatusMsg,
  }).then(async () => {
    const count = await getTotalOnlineCount();
    io.emit("online_count", { count });
    console.debug("[presence] emit user_connected", { socketId: socket.id, userId: user.id, idreg: dbIdreg, count });
    io.emit("user_connected", {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      avatar: normalizeMinioUrl(user.avatar || "/pic.png"),
      countryCode: user.countryCode,
      avatarFrameUrl: normalizeMinioUrl(user.avatarFrameUrl || ""),
      giftIconUrl: user.giftIconUrl || "",
      roomId: socket.data.user.roomId || "",
      status: user.status || "online",
      idreg: dbIdreg,
      siteBadge: user.siteBadge || "",
      statusMsg: dbStatusMsg,
      count,
    });
  }).catch(err => {
    console.error("Failed to add connected user to presence:", err);
  });

  /**
   * طلب قائمة المتصلين
   */
  socket.on("get_online_users", async (callback?: (res: any) => void) => {
    try {
      console.debug("[presence] get_online_users requested by", socket.id);
      const onlineUsers = await getAllOnlineUsers();

      // Batch-query modern and legacy profile tables for statusMsg + idreg
      const allIds = onlineUsers.map((u) => u.id).filter(Boolean);
      let profileMap = new Map<string, { msg: string | null; idreg: string | null }>();
      if (allIds.length > 0) {
        const placeholders = allIds.map((_, i) => `$${i + 1}`).join(", ");
        const result = await dbPool.query(
          `SELECT "user_id" AS id, "profile_msg" AS msg, "idreg" FROM "user_profiles" WHERE "user_id" IN (${placeholders})`,
          allIds
        );
        for (const r of result.rows) {
          profileMap.set(r.id, { msg: r.msg, idreg: r.idreg });
        }

        if (profileMap.size < allIds.length) {
          const legacyResult = await dbPool.query(
            `SELECT "id", "msg", "idreg" FROM "users" WHERE "id" IN (${placeholders})`,
            allIds
          );
          for (const r of legacyResult.rows) {
            const existing = profileMap.get(r.id);
            profileMap.set(r.id, {
              msg: existing?.msg || r.msg || null,
              idreg: existing?.idreg || r.idreg || null,
            });
          }
        }
      }

      const users = onlineUsers.map((u) => {
        const dbProfile = profileMap.get(u.id);
        const statusMsg = (dbProfile?.msg || "").toString().trim() || u.statusMsg || "";
        const idreg = (dbProfile?.idreg || "").toString().trim() || u.idreg || "";
        return {
          id: u.id,
          username: u.username,
          role: u.role,
          avatar: u.avatar,
          countryCode: u.countryCode,
          avatarFrameUrl: u.avatarFrameUrl,
          giftIconUrl: u.giftIconUrl,
          roomId: u.roomId,
          status: u.status || "online",
          idreg,
          siteBadge: u.siteBadge || "",
          statusMsg,
        };
      });
      callback?.({ success: true, users, count: users.length });
      console.debug("[presence] get_online_users response count=", users.length);
    } catch (err) {
      console.error("Failed to get online users:", err);
      callback?.({ success: false, message: "تعذر جلب قائمة المتصلين" });
    }
  });

  /**
   * تحديث بيانات المستخدم (مثل تغيير الأفاتار أو الحالة)
   */
  const handleProfileUpdate = async (data: Record<string, any>) => {
    if (!data || typeof data !== "object") return;

    const allowedKeys = ["avatar", "avatarUrl", "cover", "profileCover", "profileMsg", "avatarFrameUrl", "giftIconUrl", "messageBubbleStyle", "siteBadge", "memberCardBgUrl"];
    for (const key of allowedKeys) {
      if (typeof data[key] === "string") {
        const val = data[key].trim().slice(0, 255);
        if (key === "avatarFrameUrl") {
          (socket.data.user as any)[key] = val || "";
        } else if (key === "avatar" || key === "avatarUrl") {
          (socket.data.user as any)[key] = normalizeMinioUrl(val);
        } else {
          (socket.data.user as any)[key] = val;
        }
      }
    }

    // Keep statusMsg in sync with profileMsg
    if (typeof data.profileMsg === "string") {
      socket.data.user.statusMsg = socket.data.user.profileMsg || "";
    }

    if (typeof data.avatarUrl === "string" && !data.avatar) {
      socket.data.user.avatar = normalizeMinioUrl(data.avatarUrl.trim().slice(0, 255));
    }
    if (typeof data.profileCover === "string" && !data.cover) {
      socket.data.user.cover = data.profileCover.trim().slice(0, 255);
    }

    const oldUsername = user.username;
    if (typeof data.displayName === "string" && data.displayName.trim().length > 0) {
      user.username = data.displayName.trim().slice(0, 80);
      socket.data.user.username = user.username;
    }

    // تحديث البيانات في كاش الحضور بـ Redis
    try {
      // Also update the in-memory user profile (source of truth for get_online_users)
      const profileUpdates: { avatar?: string; cover?: string; profileMsg?: string; displayName?: string } = {};
      if (typeof data.avatar === "string" || typeof data.avatarUrl === "string") {
        profileUpdates.avatar = socket.data.user.avatar;
      }
      if (typeof data.cover === "string" || typeof data.profileCover === "string") {
        profileUpdates.cover = socket.data.user.cover;
      }
      if (typeof data.profileMsg === "string") {
        profileUpdates.profileMsg = socket.data.user.profileMsg;
      }
      if (typeof data.displayName === "string" && data.displayName.trim().length > 0) {
        profileUpdates.displayName = user.username;
      }
      if (Object.keys(profileUpdates).length > 0) {
        updateInMemoryUserProfile(user.username, profileUpdates);
      }

      const shouldPersist = Object.keys(profileUpdates).length > 0;
      if (shouldPersist) {
        await updatePersistedUserProfile(user.id, profileUpdates);
      }

      await addConnectedUser(socket.id, {
        id: user.id,
        username: user.username,
        role: user.role,
        avatar: socket.data.user.avatar,
        countryCode: user.countryCode,
        avatarFrameUrl: socket.data.user.avatarFrameUrl || "",
        giftIconUrl: socket.data.user.giftIconUrl || "",
        memberCardBgUrl: socket.data.user.memberCardBgUrl || "",
        messageBubbleStyle: socket.data.user.messageBubbleStyle || "default",
        roomId: socket.data.user.roomId || "",
        connectedAt: user.connectedAt,
        status: socket.data.user.status || "online",
        idreg: socket.data.user.idreg || user.idreg || "",
        siteBadge: socket.data.user.siteBadge || "",
        statusMsg: socket.data.user.statusMsg || "",
      });
    } catch (err) {
      console.error("Failed to update profile in Redis:", err);
    }

    updateCachedWallAuthorProfile(
      { userId: user.id, username: user.username },
      { avatar: socket.data.user.avatar || user.avatar },
    );

    io.emit("user_profile_updated", {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      previousUsername: oldUsername,
      role: user.role,
      avatar: normalizeMinioUrl(socket.data.user.avatar || user.avatar || "/pic.png"),
      avatarUrl: normalizeMinioUrl(socket.data.user.avatar || user.avatar || "/pic.png"),
      cover: socket.data.user.cover || "",
      profileCover: socket.data.user.cover || "",
      profileMsg: socket.data.user.profileMsg,
      avatarFrameUrl: socket.data.user.avatarFrameUrl ? normalizeMinioUrl(socket.data.user.avatarFrameUrl) : "",
      giftIconUrl: socket.data.user.giftIconUrl || "",
      memberCardBgUrl: socket.data.user.memberCardBgUrl || "",
      messageBubbleStyle: socket.data.user.messageBubbleStyle || "default",
      roomId: socket.data.user.roomId || "",
      idreg: socket.data.user.idreg || user.idreg || "",
      siteBadge: socket.data.user.siteBadge || "",
      statusMsg: socket.data.user.statusMsg || socket.data.user.profileMsg || "",
    });
  };

  socket.on("update_profile", handleProfileUpdate);
  socket.on("profile_update", handleProfileUpdate);

  /**
   * تحديث حالة الاتصال (مثل متصل، مشغول، بعيد)
   */
  socket.on("status_update", async (data: any) => {
    const newStatus = String(data?.status || "online").trim();
    const validStatuses = ["online", "idle", "busy", "away"];
    if (!validStatuses.includes(newStatus)) return;

    socket.data.user.status = newStatus;

    try {
      await addConnectedUser(socket.id, {
        id: user.id,
        username: user.username,
        role: user.role,
        avatar: socket.data.user.avatar || user.avatar,
        countryCode: user.countryCode,
        avatarFrameUrl: socket.data.user.avatarFrameUrl || "",
        giftIconUrl: socket.data.user.giftIconUrl || "",
        memberCardBgUrl: socket.data.user.memberCardBgUrl || "",
        messageBubbleStyle: socket.data.user.messageBubbleStyle || "default",
        roomId: socket.data.user.roomId || "",
        connectedAt: user.connectedAt,
        status: newStatus as any,
        idreg: socket.data.user.idreg || user.idreg || "",
        siteBadge: socket.data.user.siteBadge || "",
        statusMsg: socket.data.user.statusMsg || "",
      });
    } catch (err) {
      console.error("Failed to update status in Redis:", err);
    }

    io.emit("user_status_update", {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      status: newStatus,
      avatar: socket.data.user.avatar || user.avatar,
      countryCode: user.countryCode,
      roomId: socket.data.user.roomId || "",
    });
  });

  /**
   * عند طلب تسجيل خروج مباشر (يتجاوز التأخير)
   */
  socket.on("user_logout", async () => {
    try {
      const roomId = socket.data.user.roomId;
      const removedUser = await removeConnectedUser(socket.id);
      const count = await getTotalOnlineCount();
      io.emit("online_count", { count });
      io.emit("user_disconnected", {
        socketId: socket.id,
        userId: user.id,
        username: user.username,
        role: user.role,
        count,
      });

      if (removedUser && removedUser.roomId) {
        const memberCount = await getRoomMemberCount(removedUser.roomId);
        await publishGlobalEvent("room_count_update", { roomId: removedUser.roomId, memberCount });
      }

      // حذف أي مؤقتات معلقة لهذا المستخدم
      const existing = pendingDisconnects.get(user.id);
      if (existing) {
        if (existing.timeout) clearTimeout(existing.timeout);
        if (existing.presenceTimeout) clearTimeout(existing.presenceTimeout);
        pendingDisconnects.delete(user.id);
      }
    } catch (err) {
      console.error("Failed to handle user_logout:", err);
    }
  });

  /**
   * عند قطع الاتصال
   */
  socket.on("disconnect", async () => {
    try {
      const roomId = socket.data.user.roomId;

      const executeDisconnectPresence = async () => {
        try {
          const removedUser = await removeConnectedUser(socket.id);
          const count = await getTotalOnlineCount();
          io.emit("online_count", { count });
          io.emit("user_disconnected", {
            socketId: socket.id,
            userId: user.id,
            username: user.username,
            role: user.role,
            count,
          });

          if (removedUser && removedUser.roomId) {
            const memberCount = await getRoomMemberCount(removedUser.roomId);
            await publishGlobalEvent("room_count_update", { roomId: removedUser.roomId, memberCount });
          }
        } catch (err) {
          console.error("Failed delayed disconnect in presenceHandlers:", err);
        }
      };

      // تحقق هل تمت الإزالة بالفعل عبر user_logout
  const alreadyRemoved = !pendingDisconnects.has(user.id);
      const existingDisconnect = pendingDisconnects.get(user.id);
      if (existingDisconnect && existingDisconnect.socketId === socket.id) {
        await executeDisconnectPresence();
        pendingDisconnects.delete(user.id);
        return;
      }

      if (roomId && !alreadyRemoved) {
        const userKey = user.id;
        const presenceTimeout = setTimeout(() => {
          executeDisconnectPresence();
        }, 3000);

          pendingDisconnects.set(userKey, {
          roomId,
          timeout: setTimeout(() => {}, 3000),
          presenceTimeout,
          socketId: socket.id,
          userData: { ...user }
        });
      } else if (!alreadyRemoved) {
        await executeDisconnectPresence();
      }
    } catch (err) {
      console.error("Failed to remove connected user on disconnect:", err);
    }
  });
}
