import { defineEventHandler, getHeader, readBody } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { resolveRoomId } from "../../../socket/roomAccess";
import { dbPool } from "../../../db";

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

const verifySignature = (payload: string, signature: string) => {
  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export default defineEventHandler(async (event) => {
  try {
    const authHeader = getHeader(event, "authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const [payload, signature] = token.split(".");

    let userId = "";
    let username = "زائر";
    let avatar = "";
    let seatFrameUrl = "";

    if (payload && signature && verifySignature(payload, signature)) {
      try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!parsed?.exp || Date.now() <= Number(parsed.exp)) {
          userId = String(parsed.sub || "");
          username = String(parsed.username || parsed.name || "عضو");
        }
      } catch {}
    }

    // إذا لم يكن مسجلاً، يمكنه الاستماع كزائر بمعرف فريد
    if (!userId) {
      userId = `guest_${Math.random().toString(36).substring(2, 9)}`;
    } else {
      // جلب بيانات إطار المقعد والصورة من قاعدة البيانات
      try {
        const profileRes = await dbPool.query(
          `SELECT u.avatar_url, p.avatar_frame_url, p.seat_frame_url
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           WHERE u.id = $1 LIMIT 1`,
          [userId]
        );
        if (profileRes.rows[0]) {
          avatar = profileRes.rows[0].avatar_url || "";
          seatFrameUrl = profileRes.rows[0].seat_frame_url || "";
        }
      } catch (err) {
        console.warn("[VoiceToken] Error fetching user profile:", err);
      }
    }

    const body = await readBody<{ roomId: string; canPublish?: boolean }>(event);
    const rawRoomId = String(body?.roomId || "").trim();
    if (!rawRoomId) {
      return { success: false, message: "معرف الغرفة مطلوب", statusCode: 400 };
    }

    const canonicalRoomId = await resolveRoomId(rawRoomId);
    const canPublish = Boolean(body?.canPublish && !userId.startsWith("guest_"));

    const apiKey = process.env.LIVEKIT_API_KEY || "devkey";
    const apiSecret = process.env.LIVEKIT_API_SECRET || "secret_which_needs_to_be_at_least_32_characters_long_for_security";
    const livekitUrl = process.env.LIVEKIT_URL || "ws://127.0.0.1:7880";

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: username,
      metadata: JSON.stringify({
        userId,
        username,
        avatar,
        seatFrameUrl,
      }),
      ttl: "24h",
    });

    at.addGrant({
      room: canonicalRoomId,
      roomJoin: true,
      canPublish: canPublish,
      canPublishData: true,
      canSubscribe: true,
    });

    const jwt = await at.toJwt();

    return {
      success: true,
      token: jwt,
      url: livekitUrl,
      roomId: canonicalRoomId,
      canPublish,
    };
  } catch (error: any) {
    console.error("[VoiceToken] Error generating token:", error);
    return {
      success: false,
      message: error?.message || "فشل توليد رمز الدخول الصوتي",
      statusCode: 500,
    };
  }
});
