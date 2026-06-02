import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { updatePersistedUserProfile } from "../../../services/userRepository";
import { updateInMemoryUserProfile } from "../../../services/authService";
import { saveUploadBuffer } from "../../../services/uploadStorage";
import { publishGlobalEvent } from "../../../socket/SocketBroker";

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
        const savedPath = saveUploadBuffer({ kind: "avatar", userId, extension: matches[1], buffer });
        if (savedPath) updates.avatar = savedPath;
      }
    } else if (avatar) {
      updates.avatar = avatar;
    }

    if (cover && cover.startsWith("data:image/")) {
      const matches = cover.match(/^data:image\/([A-Za-z0-9+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], "base64");
        const savedPath = saveUploadBuffer({ kind: "cover", userId, extension: matches[1], buffer });
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

    publishGlobalEvent("user_profile_updated", {
      userId,
      username: updates.displayName || username,
      previousUsername: username,
      avatar: updates.avatar,
      avatarUrl: updates.avatar,
      cover: updates.cover,
      profileCover: updates.cover,
      profileMsg: updates.profileMsg,
    }).catch((err) => console.error("profile update broadcast failed:", err));

    return {
      success: true,
      updates,
      displayName: updates.displayName || username,
      dbSuccess
    };
  } catch (error: any) {
    console.error("Profile update error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء تعديل الملف الشخصي" };
  }
});
