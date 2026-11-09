import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dbPool } from "../../../db";
import { normalizeMinioUrl } from "../../../services/minioClient";
import { getIO } from "../../../socket";
import { publishGlobalEvent } from "../../../socket/SocketBroker";
import { hasPermission } from "../../../services/permissionEngine";

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
    return { success: false, message: "جلسة غير صالحة", statusCode: 401 };
  }

  let userId = "";
  let username = "";
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      return { success: false, message: "انتهت صلاحية الجلسة", statusCode: 401 };
    }
    userId = String(parsed.sub || "");
    username = String(parsed.username || parsed.name || "");
  } catch {
    return { success: false, message: "توكن غير صالح", statusCode: 401 };
  }

  const body = await readBody<{ frameUrl: string }>(event);
  const frameUrl = typeof body?.frameUrl === "string" ? body.frameUrl.trim() : "";
  if (frameUrl && !(await hasPermission(userId, "frame.use"))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية استخدام إطار الصورة" };
  }
  const normalizedUrl = frameUrl ? normalizeMinioUrl(frameUrl) : "";

  // تحديث user_profiles.avatar_frame_url فقط (يُستخدم للإطار على الصورة في المتواجدين)
  try {
    await dbPool.query(
      `INSERT INTO "user_profiles" ("user_id", "avatar_frame_url") VALUES ($1, $2)
       ON CONFLICT ("user_id") DO UPDATE SET "avatar_frame_url" = EXCLUDED."avatar_frame_url"`,
      [userId, frameUrl]
    );
  } catch (e: any) {
    console.warn("[Frame] تعذر حفظ الإطار في user_profiles:", e?.message);
  }

  // بث التحديث عبر Socket.IO لجميع العملاء
  const eventPayload = {
    userId,
    username,
    avatarFrameUrl: normalizedUrl,
  };

  const io = getIO();
  if (io) {
    io.emit("user_profile_updated", eventPayload);
  } else {
    publishGlobalEvent("user_profile_updated", eventPayload).catch(() => {});
  }

  return { success: true, avatarFrameUrl: normalizedUrl };
});
