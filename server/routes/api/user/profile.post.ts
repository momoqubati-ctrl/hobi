import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { updatePersistedUserProfile } from "../../../services/userRepository";
import { updateInMemoryUserProfile } from "../../../services/authService";
import { saveUploadBuffer } from "../../../services/uploadStorage";
import { publishGlobalEvent } from "../../../socket/SocketBroker";
import { getIO } from "../../../socket";
import { normalizeMinioUrl } from "../../../services/minioClient";
import { dbPool } from "../../../db";

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

const verifySignature = (payload: string, signature: string) => {
  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature)) {
    setResponseStatus(event, 401);
    return { success: false, message: "جلسة غير صالحة" };
  }

  let userId = "";
  let username = "";
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      setResponseStatus(event, 401);
      return { success: false, message: "انتهت صلاحية الجلسة" };
    }
    userId = String(parsed.sub || "");
    username = String(parsed.username || parsed.name || "");
  } catch (err) {
    setResponseStatus(event, 401);
    return { success: false, message: "توكن غير صالح" };
  }

  try {
    const body = await readBody(event);
    const { avatar, cover, profileMsg, displayName } = body;

    const updates: { avatar?: string; cover?: string; profileMsg?: string; displayName?: string } = {};

    if (avatar && avatar.startsWith("data:image/")) {
      const matches = avatar.match(/^data:image\/([A-Za-z0-9+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], "base64");
        const savedPath = await saveUploadBuffer({ kind: "avatar", userId, extension: matches[1], buffer });
        if (savedPath) updates.avatar = savedPath;
      }
    } else if (avatar) {
      updates.avatar = avatar;
    }

    if (cover && cover.startsWith("data:image/")) {
      const matches = cover.match(/^data:image\/([A-Za-z0-9+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], "base64");
        const savedPath = await saveUploadBuffer({ kind: "cover", userId, extension: matches[1], buffer });
        if (savedPath) updates.cover = savedPath;
      }
    } else if (cover) {
      updates.cover = cover;
    }

    if (profileMsg !== undefined) {
      updates.profileMsg = profileMsg;
    }

    if (displayName !== undefined && typeof displayName === "string" && displayName.trim().length > 0) {
      updates.displayName = displayName.trim().slice(0, 120);
    }

    // 2. Update Database
    const dbSuccess = await updatePersistedUserProfile(userId, updates);

    // 3. Update in-memory fallback
    updateInMemoryUserProfile(username, { ...updates, displayName: updates.displayName || username });

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

    const eventPayload = {
      userId,
      username: updates.displayName || username,
      previousUsername: username,
      role: "member",
      avatar: currentAvatarUrl,
      avatarUrl: currentAvatarUrl,
      cover: updates.cover ? normalizeMinioUrl(updates.cover) : undefined,
      profileCover: updates.cover ? normalizeMinioUrl(updates.cover) : undefined,
      profileMsg: updates.profileMsg,
      statusMsg: updates.profileMsg || "",
      siteBadge: updates.siteBadge || "",
    };

    // Always read the latest canonical profile data from DB after update to ensure correct broadcast
    try {
      const latestRow = await dbPool.query(
        `SELECT "profile_msg", "avatar_url", "banner_url", "idreg" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
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
      displayName: updates.displayName || username,
      dbSuccess
    };
  } catch (error: any) {
    console.error("Profile update error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء تعديل الملف الشخصي" };
  }
});
