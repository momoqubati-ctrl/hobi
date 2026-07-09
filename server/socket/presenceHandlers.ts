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
import { updateUserMessageIdentity } from "../services/chatStore";

export async function registerPresenceHandlers(io: Server, socket: Socket): Promise<void> {
  const user = socket.data.user;

  // تسجيل المستخدم عند الاتصال
  const inMemProfile = findInMemoryUser(user.id) || findInMemoryUser(user.username);
  const resolvedStatusMsg = (inMemProfile?.profile?.profileMsg || "").trim() || user.statusMsg || "";

  // Also try to enrich from DB for idreg + statusMsg using both modern and legacy sources
  let dbIdreg = user.idreg || "";
  let dbStatusMsg = resolvedStatusMsg;
  let dbMemberCardBg = "";
  let dbAvatarFrameUrl = "";
  let dbNameColor = "";
  let dbMessageColor = "";
  let dbStatusFontColor = "";
  let dbGiftedBannerUrl = "";
  let dbGiftedGiftIconUrl = "";
  let dbGiftedPromotionIconUrl = "";
  let dbRoleIconUrl = "";
  let legacyColors: any = null;
  try {
    const profileResult = await dbPool.query(
      `SELECT "profile_msg", "idreg", "avatar_frame_url", "member_card_bg_url", "name_color", "message_color", "status_font_color", "gifted_banner_url", "gifted_gift_icon_url", "gifted_promotion_icon_url" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
      [user.id]
    );
    const profileRow = profileResult.rows[0];
    let legacyRow: any = null;
    if (!profileRow || !String(profileRow.profile_msg || "").trim()) {
      const legacyResult = await dbPool.query(`SELECT "msg", "idreg", "ucol", "mcol" FROM "users" WHERE "id" = $1 LIMIT 1`, [user.id]);
      legacyRow = legacyResult.rows[0];
    }

    if (profileRow) {
      dbIdreg = (profileRow.idreg || "").toString().trim() || dbIdreg;
      dbStatusMsg = (profileRow.profile_msg || "").toString().trim() || dbStatusMsg;
      dbMemberCardBg = (profileRow.member_card_bg_url || "").toString().trim();
      dbAvatarFrameUrl = (profileRow.avatar_frame_url || "").toString().trim();
      dbNameColor = (profileRow.name_color || "").toString().trim();
      dbMessageColor = (profileRow.message_color || "").toString().trim();
      dbStatusFontColor = (profileRow.status_font_color || "").toString().trim();
      dbGiftedBannerUrl = (profileRow.gifted_banner_url || "").toString().trim();
      dbGiftedGiftIconUrl = (profileRow.gifted_gift_icon_url || "").toString().trim();
      dbGiftedPromotionIconUrl = (profileRow.gifted_promotion_icon_url || "").toString().trim();
    } else if (legacyRow) {
      dbIdreg = (legacyRow.idreg || "").toString().trim() || dbIdreg;
      dbStatusMsg = (legacyRow.msg || "").toString().trim() || dbStatusMsg;
      dbNameColor = (legacyRow.ucol || "").toString().trim();
      dbMessageColor = (legacyRow.mcol || "").toString().trim();
    }
  } catch (_) {}

  // Fetch role icon from user_role_assignments + roles
  try {
    const roleResult = await dbPool.query(
      `SELECT r.icon_url AS role_icon_url
       FROM user_role_assignments ura
       JOIN roles r ON r.id = ura.role_id AND r.is_active = true
       WHERE ura.user_id = $1
       ORDER BY r.rank DESC
       LIMIT 1`,
      [user.id]
    );
    if (roleResult.rows[0]?.role_icon_url) {
      dbRoleIconUrl = String(roleResult.rows[0].role_icon_url).trim();
    }
  } catch (_) {}

  // Final fallback: read legacy ucol/mcol if still empty
  if (!dbNameColor || !dbMessageColor) {
    try {
      const result = await dbPool.query(`SELECT "ucol", "mcol" FROM "users" WHERE "id" = $1 LIMIT 1`, [user.id]);
      legacyColors = result.rows[0];
      if (legacyColors) {
        if (!dbNameColor) dbNameColor = (legacyColors.ucol || "").toString().trim();
        if (!dbMessageColor) dbMessageColor = (legacyColors.mcol || "").toString().trim();
      }
    } catch (_) {}
  }

  await addConnectedUser(socket.id, {
    id: user.id,
    username: user.username,
    role: user.role,
    avatar: user.avatar,
    countryCode: user.countryCode,
    avatarFrameUrl: dbAvatarFrameUrl || user.avatarFrameUrl || "",
    giftIconUrl: user.giftIconUrl || "",
    memberCardBgUrl: dbMemberCardBg || user.memberCardBgUrl || "",
    nameColor: dbNameColor || user.nameColor || "",
    messageColor: dbMessageColor || user.messageColor || "",
    statusFontColor: dbStatusFontColor || user.statusFontColor || "",
    messageBubbleStyle: user.messageBubbleStyle || "default",
    roomId: "",
    connectedAt: user.connectedAt,
    status: user.status || "online",
    idreg: dbIdreg,
    siteBadge: user.siteBadge || "",
    statusMsg: dbStatusMsg,
    giftedBannerUrl: dbGiftedBannerUrl || "",
    giftedGiftIconUrl: dbGiftedGiftIconUrl || "",
    giftedPromotionIconUrl: dbGiftedPromotionIconUrl || "",
    roleIconUrl: dbRoleIconUrl || "",
  }).catch(err => {
    console.error("Failed to add connected user to presence:", err);
  });

  const pendingDisconnect = pendingDisconnects.get(user.id);
  if (pendingDisconnect) {
    if (pendingDisconnect.socketId !== socket.id) {
      clearTimeout(pendingDisconnect.timeout);
      clearTimeout(pendingDisconnect.presenceTimeout);
      pendingDisconnects.delete(user.id);
      console.debug("[presence] canceled pending disconnect for reconnecting user", { userId: user.id, oldSocketId: pendingDisconnect.socketId, newSocketId: socket.id });
    }
  }

  // Emit user_connected directly (not inside .then) to ensure it always fires
  try {
    const count = await getTotalOnlineCount();
    io.emit("online_count", { count });
    const frameUrl = dbAvatarFrameUrl || user.avatarFrameUrl || "";
    const bgUrl = dbMemberCardBg || user.memberCardBgUrl || "";
    console.debug("[presence] emit user_connected", { socketId: socket.id, userId: user.id, idreg: dbIdreg, count, giftedBannerUrl: dbGiftedBannerUrl });
    io.emit("user_connected", {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      avatar: normalizeMinioUrl(user.avatar || "/pic.png"),
      countryCode: user.countryCode,
      avatarFrameUrl: frameUrl ? normalizeMinioUrl(frameUrl) : "",
      giftIconUrl: user.giftIconUrl || "",
      memberCardBgUrl: bgUrl,
      nameColor: dbNameColor || user.nameColor || "",
      messageColor: dbMessageColor || user.messageColor || "",
      statusFontColor: dbStatusFontColor || user.statusFontColor || "",
      roomId: socket.data.user.roomId || "",
      status: user.status || "online",
      idreg: dbIdreg,
      siteBadge: user.siteBadge || "",
      statusMsg: dbStatusMsg,
      giftedBannerUrl: dbGiftedBannerUrl || "",
      giftedGiftIconUrl: dbGiftedGiftIconUrl || "",
      giftedPromotionIconUrl: dbGiftedPromotionIconUrl || "",
      roleIconUrl: dbRoleIconUrl || "",
      count,
    });
  } catch (err) {
    console.error("Failed to emit user_connected:", err);
  }

  /**
   * طلب قائمة المتصلين
   */
  socket.on("get_online_users", async (callback?: (res: any) => void) => {
    try {
      console.debug("[presence] get_online_users requested by", socket.id);
      const onlineUsers = await getAllOnlineUsers();

      // Batch-query modern and legacy profile tables for statusMsg + idreg
      const allIds = onlineUsers.map((u) => u.id).filter(Boolean);
      let profileMap = new Map<string, { msg: string | null; idreg: string | null; nameColor: string | null; messageColor: string | null; statusFontColor: string | null; giftedBannerUrl: string; giftedGiftIconUrl: string; giftedPromotionIconUrl: string; roleIconUrl: string }>();
      if (allIds.length > 0) {
        const placeholders = allIds.map((_, i) => `$${i + 1}`).join(", ");
        const result = await dbPool.query(
          `SELECT "user_id" AS id, "profile_msg" AS msg, "idreg", "name_color", "message_color", "status_font_color", "gifted_banner_url", "gifted_gift_icon_url", "gifted_promotion_icon_url" FROM "user_profiles" WHERE "user_id" IN (${placeholders})`,
          allIds
        );
        for (const r of result.rows) {
          profileMap.set(r.id, { msg: r.msg, idreg: r.idreg, nameColor: r.name_color, messageColor: r.message_color, statusFontColor: r.status_font_color, giftedBannerUrl: r.gifted_banner_url || "", giftedGiftIconUrl: r.gifted_gift_icon_url || "", giftedPromotionIconUrl: r.gifted_promotion_icon_url || "", roleIconUrl: "" });
        }

        // Fetch role icons for all users in batch
        try {
          const roleResult = await dbPool.query(
            `SELECT ura.user_id, r.icon_url AS role_icon_url
             FROM user_role_assignments ura
             JOIN roles r ON r.id = ura.role_id AND r.is_active = true
             WHERE ura.user_id IN (${placeholders})
             ORDER BY r.rank DESC`,
            allIds
          );
          // Keep highest rank role icon per user
          for (const r of roleResult.rows) {
            const existing = profileMap.get(r.user_id);
            if (existing && !existing.roleIconUrl && r.role_icon_url) {
              existing.roleIconUrl = String(r.role_icon_url).trim();
            }
          }
        } catch (_) {}

        // Fallback للأعضاء الذين ليس لهم سجل في user_profiles
        // نستعلم فقط عن المفقودين، ولا نُعيد كتابة من عنده بيانات
        const missingIds = allIds.filter((id) => !profileMap.has(id));
        if (missingIds.length > 0) {
          const legacyPlaceholders = missingIds.map((_, i) => `$${i + 1}`).join(", ");
          const legacyResult = await dbPool.query(
            `SELECT "id", "msg", "idreg", "ucol", "mcol" FROM "users" WHERE "id" IN (${legacyPlaceholders})`,
            missingIds
          );
          for (const r of legacyResult.rows) {
            // فقط نضيف من ليس في الخريطة — لا نُعيد كتابة من فيها
            if (!profileMap.has(r.id)) {
              profileMap.set(r.id, {
                msg: r.msg || null,
                idreg: r.idreg || null,
                nameColor: r.ucol || null,
                messageColor: r.mcol || null,
                statusFontColor: null,
                giftedBannerUrl: "",
                giftedGiftIconUrl: "",
                giftedPromotionIconUrl: "",
                roleIconUrl: "",
              });
            }
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
          memberCardBgUrl: u.memberCardBgUrl || "",
          nameColor: dbProfile?.nameColor || u.nameColor || "",
          messageColor: dbProfile?.messageColor || u.messageColor || "",
          statusFontColor: dbProfile?.statusFontColor || u.statusFontColor || "",
          roomId: u.roomId,
          status: u.status || "online",
          idreg,
          siteBadge: u.siteBadge || "",
          statusMsg,
          giftedBannerUrl: dbProfile?.giftedBannerUrl || (u as any).giftedBannerUrl || "",
          giftedGiftIconUrl: dbProfile?.giftedGiftIconUrl || (u as any).giftedGiftIconUrl || "",
          giftedPromotionIconUrl: dbProfile?.giftedPromotionIconUrl || (u as any).giftedPromotionIconUrl || "",
          roleIconUrl: dbProfile?.roleIconUrl || (u as any).roleIconUrl || "",
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

    const allowedKeys = ["avatar", "avatarUrl", "cover", "profileCover", "profileMsg", "avatarFrameUrl", "giftIconUrl", "messageBubbleStyle", "siteBadge", "memberCardBgUrl", "nameColor", "messageColor", "statusFontColor", "giftedBannerUrl", "giftedGiftIconUrl", "giftedPromotionIconUrl"];
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
      const profileUpdates: { avatar?: string; cover?: string; profileMsg?: string; displayName?: string; nameColor?: string; messageColor?: string; statusFontColor?: string } = {};
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
      if (typeof data.nameColor === "string") {
        console.log("[presenceHandlers] Setting nameColor in socket.data.user:", data.nameColor);
        profileUpdates.nameColor = data.nameColor.trim().slice(0, 20);
      }
      if (typeof data.messageColor === "string") {
        console.log("[presenceHandlers] Setting messageColor in socket.data.user:", data.messageColor);
        profileUpdates.messageColor = data.messageColor.trim().slice(0, 20);
      }
      if (typeof data.statusFontColor === "string") {
        console.log("[presenceHandlers] Setting statusFontColor in socket.data.user:", data.statusFontColor);
        profileUpdates.statusFontColor = data.statusFontColor.trim().slice(0, 20);
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
        nameColor: socket.data.user.nameColor || "",
        messageColor: socket.data.user.messageColor || "",
        messageBubbleStyle: socket.data.user.messageBubbleStyle || "default",
        roomId: socket.data.user.roomId || "",
        connectedAt: user.connectedAt,
        status: socket.data.user.status || "online",
        idreg: socket.data.user.idreg || user.idreg || "",
        siteBadge: socket.data.user.siteBadge || "",
        statusMsg: socket.data.user.statusMsg || "",
        giftedBannerUrl: (socket.data.user as any).giftedBannerUrl || "",
        giftedGiftIconUrl: (socket.data.user as any).giftedGiftIconUrl || "",
        giftedPromotionIconUrl: (socket.data.user as any).giftedPromotionIconUrl || "",
        roleIconUrl: (socket.data.user as any).roleIconUrl || "",
      });

      console.log("[presenceHandlers] addConnectedUser called with nameColor:", socket.data.user.nameColor);
    } catch (err) {
      console.error("Failed to update profile in Redis:", err);
    }

    // Update cached room messages with the new profile data
    updateUserMessageIdentity(user.username, {
      avatar: socket.data.user.avatar || user.avatar,
      nameColor: socket.data.user.nameColor || "",
      statusFontColor: socket.data.user.statusFontColor || "",
    });

    updateCachedWallAuthorProfile(
      { userId: user.id, username: user.username },
      {
        avatar: socket.data.user.avatar || user.avatar,
        nameColor: socket.data.user.nameColor !== undefined ? socket.data.user.nameColor : "",
      },
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
      nameColor: socket.data.user.nameColor || "",
      messageColor: socket.data.user.messageColor || "",
      statusFontColor: socket.data.user.statusFontColor || "",
      messageBubbleStyle: socket.data.user.messageBubbleStyle || "default",
      roomId: socket.data.user.roomId || "",
      idreg: socket.data.user.idreg || user.idreg || "",
      siteBadge: socket.data.user.siteBadge || "",
      statusMsg: socket.data.user.statusMsg || socket.data.user.profileMsg || "",
      giftedBannerUrl: (socket.data.user as any).giftedBannerUrl || "",
      giftedGiftIconUrl: (socket.data.user as any).giftedGiftIconUrl || "",
      giftedPromotionIconUrl: (socket.data.user as any).giftedPromotionIconUrl || "",
      roleIconUrl: (socket.data.user as any).roleIconUrl || "",
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
        nameColor: socket.data.user.nameColor || "",
        messageColor: socket.data.user.messageColor || "",
        statusFontColor: socket.data.user.statusFontColor || "",
        messageBubbleStyle: socket.data.user.messageBubbleStyle || "default",
        roomId: socket.data.user.roomId || "",
        connectedAt: user.connectedAt,
        status: newStatus as any,
        idreg: socket.data.user.idreg || user.idreg || "",
        siteBadge: socket.data.user.siteBadge || "",
        statusMsg: socket.data.user.statusMsg || "",
        giftedBannerUrl: (socket.data.user as any).giftedBannerUrl || "",
        giftedGiftIconUrl: (socket.data.user as any).giftedGiftIconUrl || "",
        giftedPromotionIconUrl: (socket.data.user as any).giftedPromotionIconUrl || "",
        roleIconUrl: (socket.data.user as any).roleIconUrl || "",
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
