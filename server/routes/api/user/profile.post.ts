import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { getUserAuthContext } from "../../../services/adminAccess";
import { updatePersistedUserProfile } from "../../../services/userRepository";
import { updateInMemoryUserProfile } from "../../../services/authService";
import { saveUploadBuffer } from "../../../services/uploadStorage";
import { publishGlobalEvent } from "../../../socket/SocketBroker";
import { getIO } from "../../../socket";
import { normalizeMinioUrl } from "../../../services/minioClient";
import { dbPool } from "../../../db";

const ALLOWED_PROFILE_IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId) {
    setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
    return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
  }

  const userId = auth.userId;
  const username = auth.username;

  try {
    const body = await readBody(event);
    const {
      avatar,
      cover,
      profileMsg,
      mentionName,
      displayName,
      nameColor,
      messageColor,
      statusFontColor,
      youtubeUrl,
    } = body || {};

    console.log("[API] Profile update request:", {
      userId,
      hasAvatar: !!avatar,
      hasCover: !!cover,
      hasProfileMsg: profileMsg !== undefined,
      hasMentionName: mentionName !== undefined,
      displayName,
    });

    const updates: {
      avatar?: string;
      cover?: string;
      profileMsg?: string;
      mentionName?: string | null;
      displayName?: string;
      nameColor?: string;
      messageColor?: string;
      statusFontColor?: string;
      youtubeUrl?: string;
      siteBadge?: string;
    } = {};

    if (avatar && typeof avatar === "string" && avatar.startsWith("data:image/")) {
      const matches = avatar.match(/^data:image\/([A-Za-z0-9+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const rawExt = matches[1].toLowerCase().replace(/^svg\+xml$/, "").replace(/^svg$/, "");
        const ext = rawExt === "jpeg" ? "jpg" : rawExt;
        if (ALLOWED_PROFILE_IMAGE_TYPES.has(ext)) {
          const buffer = Buffer.from(matches[2], "base64");
          const savedPath = await saveUploadBuffer({ kind: "avatar", userId, extension: ext, buffer });
          if (savedPath) updates.avatar = savedPath;
        }
      }
    } else if (avatar && typeof avatar === "string" && !avatar.toLowerCase().includes(".svg") && !avatar.toLowerCase().includes(".xml")) {
      updates.avatar = avatar;
    }

    if (cover && typeof cover === "string" && cover.startsWith("data:image/")) {
      const matches = cover.match(/^data:image\/([A-Za-z0-9+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const rawExt = matches[1].toLowerCase().replace(/^svg\+xml$/, "").replace(/^svg$/, "");
        const ext = rawExt === "jpeg" ? "jpg" : rawExt;
        if (ALLOWED_PROFILE_IMAGE_TYPES.has(ext)) {
          const buffer = Buffer.from(matches[2], "base64");
          const savedPath = await saveUploadBuffer({ kind: "cover", userId, extension: ext, buffer });
          if (savedPath) updates.cover = savedPath;
        }
      }
    } else if (cover && typeof cover === "string" && !cover.toLowerCase().includes(".svg") && !cover.toLowerCase().includes(".xml")) {
      updates.cover = cover;
    }

    if (profileMsg !== undefined && typeof profileMsg === "string") {
      updates.profileMsg = profileMsg.slice(0, 500);
    }

    if (mentionName !== undefined) {
      const trimmedMention = typeof mentionName === "string" ? mentionName.trim().toLowerCase().replace(/^@/, "") : "";
      if (trimmedMention) {
        if (!/^[a-z0-9_-]{2,32}$/.test(trimmedMention)) {
          setResponseStatus(event, 400);
          return { success: false, message: "اسم المنشن يجب أن يتكون من 2 إلى 32 حرفاً أو رقماً إنجليزياً" };
        }
        const conflict = await dbPool.query(
          `SELECT id FROM users WHERE lower(mention_name) = lower($1) AND CAST(id AS text) != $2 AND CAST(uid AS text) != $2 LIMIT 1`,
          [trimmedMention, userId]
        );
        if (conflict.rows.length > 0) {
          setResponseStatus(event, 400);
          return { success: false, message: "اسم المنشن مستخدم بالفعل، يرجى اختيار اسم آخر" };
        }
        updates.mentionName = trimmedMention;
      } else {
        updates.mentionName = null;
      }
    }

    if (displayName !== undefined && typeof displayName === "string" && displayName.trim().length > 0) {
      updates.displayName = displayName.trim().slice(0, 120);
    }

    if (nameColor !== undefined && typeof nameColor === "string") {
      updates.nameColor = nameColor.trim().slice(0, 20);
    }
    if (messageColor !== undefined && typeof messageColor === "string") {
      updates.messageColor = messageColor.trim().slice(0, 20);
    }
    if (statusFontColor !== undefined && typeof statusFontColor === "string") {
      updates.statusFontColor = statusFontColor.trim().slice(0, 20);
    }

    if (youtubeUrl !== undefined && typeof youtubeUrl === "string") {
      updates.youtubeUrl = youtubeUrl.trim().slice(0, 255);
    }

    // 2. Update Database
    const dbSuccess = await updatePersistedUserProfile(userId, updates);

    // 3. Update in-memory fallback
    updateInMemoryUserProfile(username, { ...updates, displayName: updates.displayName || updates.displayName });

    // 4. Always fetch the latest avatar from DB to broadcast the current pic
    let currentAvatarUrl: string | undefined = updates.avatar ? normalizeMinioUrl(updates.avatar) : undefined;
    if (!currentAvatarUrl) {
      try {
        const picRes = await dbPool.query(
          `SELECT pic FROM users WHERE CAST(uid AS text) = $1 OR CAST(id AS text) = $1 OR CAST(idreg AS text) = $1 LIMIT 1`,
          [userId]
        );
        if (picRes.rows[0]?.pic) {
          currentAvatarUrl = normalizeMinioUrl(picRes.rows[0].pic);
        }
      } catch {}
    }

    const eventPayload: Record<string, unknown> = {
      userId,
      // الاسم المستعار فقط — الحدث مذاع لجميع الأعضاء
      username: updates.displayName || "",
      previousUsername: updates.displayName ? "" : undefined,
      role: "member",
      avatar: currentAvatarUrl,
      avatarUrl: currentAvatarUrl,
      cover: updates.cover ? normalizeMinioUrl(updates.cover) : undefined,
      profileCover: updates.cover ? normalizeMinioUrl(updates.cover) : undefined,
      profileMsg: updates.profileMsg,
      statusMsg: updates.profileMsg || "",
      siteBadge: updates.siteBadge || "",
      nameColor: updates.nameColor,
      messageColor: updates.messageColor,
      statusFontColor: updates.statusFontColor,
      youtubeUrl: updates.youtubeUrl,
    };

    // Always read the latest canonical profile data from DB after update to ensure correct broadcast
    try {
      const latestRow = await dbPool.query(
        `SELECT "profile_msg", "avatar_url", "banner_url", "idreg", "name_color", "message_color", "status_font_color" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
        [userId],
      );
      if (latestRow.rows[0]) {
        const row = latestRow.rows[0];
        const canonicalMsg = String(row.profile_msg || "").trim();
        if (canonicalMsg) {
          eventPayload.statusMsg = canonicalMsg;
          if (!eventPayload.profileMsg) eventPayload.profileMsg = canonicalMsg;
        }
        if (row.avatar_url) {
          currentAvatarUrl = normalizeMinioUrl(row.avatar_url);
          eventPayload.avatar = currentAvatarUrl;
          eventPayload.avatarUrl = currentAvatarUrl;
        }
        if (row.banner_url) {
          eventPayload.cover = normalizeMinioUrl(row.banner_url);
          eventPayload.profileCover = eventPayload.cover;
        }
        if (row.idreg) eventPayload.idreg = String(row.idreg).trim();
        if (row.name_color) eventPayload.nameColor = String(row.name_color).trim();
        if (row.message_color) eventPayload.messageColor = String(row.message_color).trim();
        if (row.status_font_color) eventPayload.statusFontColor = String(row.status_font_color).trim();
      }
    } catch {}

    // Try direct broadcast via Socket.IO instance (more reliable across Vite contexts)
    const io = getIO();
    if (io) {
      io.emit("user_profile_updated", eventPayload);
    } else {
      publishGlobalEvent("user_profile_updated", eventPayload).catch((err) => console.error("profile update broadcast failed:", err));
    }

    return {
      success: true,
      updates,
      normalizedAvatar: currentAvatarUrl,
      displayName: updates.displayName || "",
      mentionName: updates.mentionName,
      nameColor: updates.nameColor,
      messageColor: updates.messageColor,
      statusFontColor: updates.statusFontColor,
      dbSuccess,
    };
  } catch (error: any) {
    console.error("Profile update error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء تعديل الملف الشخصي" };
  }
});
