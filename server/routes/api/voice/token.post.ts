import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { verifyAuthToken } from "../../../services/authService";
import {
  canAccessVoiceRoom,
  canPublishFromSeat,
  getVoiceTokenPermissions,
} from "../../../services/voiceTokenAccess";
import { voiceStageStore } from "../../../services/voiceStageStore";
import { isUserConnectedToRoom } from "../../../socket/presenceManager";
import { resolveRoomId } from "../../../socket/roomAccess";
import { dbPool } from "../../../db";
import { hasChatFeatureAccess } from "../../../services/chatAuthorization";
import { createVoiceProviderStore } from "../../../services/voiceProviderStore";
import { ensureConfiguredLiveKitRoom } from "../../../services/livekitVoicePermissions";

const respondWithError = (
  event: Parameters<typeof setResponseStatus>[0],
  statusCode: number,
  message: string,
) => {
  setResponseStatus(event, statusCode);
  return { success: false, message, statusCode };
};

export default defineEventHandler(async (event) => {
  try {
    const authorization = getHeader(event, "authorization") || "";
    const bearerToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
    const claims = verifyAuthToken(bearerToken);
    if (!claims) {
      return respondWithError(event, 401, "جلسة غير صالحة أو منتهية");
    }

    const body = await readBody<{ roomId?: unknown }>(event);
    const rawRoomId = String(body?.roomId ?? "").trim();
    if (!rawRoomId || rawRoomId.length > 200) {
      return respondWithError(event, 400, "معرف الغرفة غير صالح");
    }

    const livekitConfig = await createVoiceProviderStore().getRuntimeConfig();
    const apiKey = livekitConfig?.apiKey.trim();
    const apiSecret = livekitConfig?.apiSecret.trim();
    const livekitUrl = livekitConfig?.url.trim();
    if (
      !apiKey ||
      apiKey === "devkey" ||
      !apiSecret ||
      apiSecret.length < 32 ||
      apiSecret === "secret_which_needs_to_be_at_least_32_characters_long_for_security" ||
      !livekitUrl
    ) {
      console.error("[VoiceToken] LiveKit credentials or URL are not securely configured");
      return respondWithError(event, 503, "خدمة الصوت غير مهيأة");
    }

    let parsedLivekitUrl: URL;
    try {
      parsedLivekitUrl = new URL(livekitUrl);
    } catch {
      return respondWithError(event, 503, "إعدادات خدمة الصوت غير صالحة");
    }
    if (
      !["ws:", "wss:"].includes(parsedLivekitUrl.protocol) ||
      parsedLivekitUrl.username ||
      parsedLivekitUrl.password ||
      parsedLivekitUrl.pathname !== "/" ||
      parsedLivekitUrl.search ||
      parsedLivekitUrl.hash ||
      (process.env.NODE_ENV === "production" && parsedLivekitUrl.protocol !== "wss:")
    ) {
      return respondWithError(event, 503, "إعدادات خدمة الصوت غير آمنة");
    }

    const isGuest = claims.role.trim().toLowerCase() === "guest";
    let userId = claims.sub;
    let username = claims.username;
    let avatar = "";
    let seatFrameUrl = "";
    let accountStatus = "active";

    if (!isGuest) {
      const userResult = await dbPool.query(
        `SELECT CAST(u.id AS text) AS id, u.username, u.status, u.avatar_url, p.seat_frame_url
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE CAST(u.id AS text) = $1
         LIMIT 1`,
        [claims.sub],
      );
      const user = userResult.rows[0];
      if (!user?.id) {
        return respondWithError(event, 401, "الحساب غير صالح");
      }

      accountStatus = String(user.status || "active");
      if (accountStatus !== "active") {
        return respondWithError(event, 403, "الحساب محظور أو معلق");
      }

      userId = String(user.id);
      username = String(user.username || claims.username);
      avatar = String(user.avatar_url || "");
      seatFrameUrl = String(user.seat_frame_url || "");
    }

    const resolvedRoomId = await resolveRoomId(rawRoomId);
    const roomResult = await dbPool.query(
      `SELECT CAST(id AS text) AS id
       FROM rooms
       WHERE CAST(id AS text) = $1
       LIMIT 1`,
      [resolvedRoomId],
    );
    const canonicalRoomId = String(roomResult.rows[0]?.id || "");
    if (!canonicalRoomId) {
      return respondWithError(event, 404, "الغرفة غير موجودة");
    }

    // Fail-Closed: التحقق من عدم وجود حظر أو طرد نشط للمستخدم في هذه الغرفة
    const kickResult = await dbPool.query(
      `SELECT banned_until FROM room_kicks
       WHERE (room_id = $1 OR lower(room_id) = lower($1) OR room_id = $2)
         AND (user_id = $3 OR lower(user_id) = lower($3))
         AND banned_until > now()
       ORDER BY banned_until DESC
       LIMIT 1`,
      [canonicalRoomId, resolvedRoomId, userId],
    );
    const isKickedOrBanned = (kickResult.rowCount ?? 0) > 0;
    if (isKickedOrBanned) {
      return respondWithError(event, 403, "تم طردك من الغرفة مؤقتاً");
    }

    const isConnected = await isUserConnectedToRoom(userId, canonicalRoomId);
    const hasAccess = canAccessVoiceRoom({
      isRoomMember: isConnected,
      isKickedOrBanned,
      accountStatus: !isGuest ? accountStatus : undefined,
    });
    if (!hasAccess) {
      return respondWithError(event, 403, "يجب الانضمام إلى الغرفة قبل طلب رمز الصوت");
    }

    const stage = await voiceStageStore.getStage(canonicalRoomId);
    const seat = stage?.seats.find((entry) => entry?.userId === userId);
    const canPublish =
      !isGuest &&
      (await hasChatFeatureAccess({ id: userId, role: claims.role }, ["room_voice.use"])) &&
      canPublishFromSeat(seat, claims.role);
    const permissions = getVoiceTokenPermissions(hasAccess, canPublish);
    if (!permissions) {
      return respondWithError(event, 403, "لا تملك صلاحية دخول الغرفة الصوتية");
    }

    await ensureConfiguredLiveKitRoom(canonicalRoomId);

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: username,
      metadata: JSON.stringify({
        userId,
        username,
        avatar,
        seatFrameUrl,
      }),
      ttl: "5m",
    });

    accessToken.addGrant({
      room: canonicalRoomId,
      roomJoin: permissions.canJoin,
      canPublish: permissions.canPublish,
      canPublishSources: permissions.canPublish
        ? [TrackSource.MICROPHONE]
        : [],
      canPublishData: permissions.canPublishData,
      canSubscribe: permissions.canSubscribe,
    });

    return {
      success: true,
      token: await accessToken.toJwt(),
      url: livekitUrl,
      roomId: canonicalRoomId,
      canPublish: permissions.canPublish,
    };
  } catch (error) {
    console.error("[VoiceToken] Error generating token:", error);
    return respondWithError(event, 500, "تعذر إصدار رمز الصوت");
  }
});
