import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from "h3";
import { addMessage } from "../../../../services/chatStore";
import { getUserAuthContext } from "../../../../services/adminAccess";
import { hasChatFeatureAccess } from "../../../../services/chatAuthorization";
import { getMessagePermissionRequirements } from "../../../../../src/lib/chatFeaturePermissions";
import { dbPool } from "../../../../db";

export default defineEventHandler(async (event) => {
  const roomId = getRouterParam(event, "roomId");
  const body = await readBody(event);
  const auth = getUserAuthContext(event);

  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { success: false, message: auth.message };
  }

  if (!roomId) {
    setResponseStatus(event, 400);
    return {
      success: false,
      message: "معرف الغرفة مطلوب",
    };
  }

  if (typeof body?.text !== "string" || !body.text.trim()) {
    setResponseStatus(event, 400);
    return {
      success: false,
      message: "نص الرسالة مطلوب",
    };
  }

  if (body.text.trim().length > 1000) {
    setResponseStatus(event, 413);
    return {
      success: false,
      message: "الرسالة طويلة جداً",
    };
  }

  const requiredPermissions = getMessagePermissionRequirements({
    channel: "room",
    text: body.text.trim(),
  });
  if (!(await hasChatFeatureAccess({ id: auth.userId, role: auth.role }, requiredPermissions))) {
    setResponseStatus(event, 403);
    return { success: false, message: "لا تملك صلاحية إرسال رسائل الغرف" };
  }
  if (auth.role !== "guest") {
    const userResult = await dbPool.query(
      `SELECT u.muted AS legacy_muted, up.muted AS profile_muted
       FROM users u
       LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
       WHERE CAST(u.id AS text) = $1
       LIMIT 1`,
      [auth.userId],
    );
    const user = userResult.rows[0];
    if (user && (Boolean(user.profile_muted) || Boolean(user.legacy_muted && user.legacy_muted !== 0 && user.legacy_muted !== "0"))) {
      setResponseStatus(event, 403);
      return { success: false, message: "تم منعك من الحديث في الدردشة" };
    }

    // الكتم الغرفي (منفصل عن الكتم العام)
    try {
      const { roomMuteService } = await import("../../../services/roomMuteService");
      const roomMuted = await roomMuteService.isRoomMutedForUser([roomId], auth.userId);
      if (roomMuted) {
        setResponseStatus(event, 403);
        return { success: false, muted: true, roomMuted: true, message: "تم منعك من الحديث في هذه الغرفة" };
      }
    } catch (err) {
      console.error("[RoomMessage] room mute check failed:", err);
    }
  }

  const message = await addMessage({
    roomId,
    clientId: typeof body.clientId === "string" ? body.clientId : undefined,
    user: auth.username,
    role: auth.role,
    countryCode: typeof body.countryCode === "string" ? body.countryCode : undefined,
    avatar: typeof body.avatar === "string" ? body.avatar : undefined,
    avatarFrameUrl: typeof body.avatarFrameUrl === "string" ? body.avatarFrameUrl : undefined,
    giftIconUrl: typeof body.giftIconUrl === "string" ? body.giftIconUrl : undefined,
    messageBubbleStyle: typeof body.messageBubbleStyle === "string" ? body.messageBubbleStyle : undefined,
    text: body.text,
  });

  return {
    success: true,
    message,
  };
});
