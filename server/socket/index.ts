/**
 * Socket.io Server Setup
 * يتعامل مع إنشاء خادم Socket.io وربطه مع Nitro
 */
import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { registerRoomHandlers } from "./roomHandlers";
import { registerPresenceHandlers } from "./presenceHandlers";
import { registerPrivateHandlers } from "./privateHandlers";
import { registerProfileHandlers } from "./profileHandlers";
import { registerStoryHandlers } from "./storyHandlers";
import { registerWallHandlers } from "./wallHandlers";
import { registerNotificationHandlers } from "./notificationHandlers";
import { registerMailHandlers } from "./mailHandlers";
import { registerVoiceStageHandlers } from "./voiceStageHandlers";
import { registerCallHandlers } from "./callHandlers";
import { configureSocketGateway, registerSocketConnection } from "./SocketGateway";
import { initializeSocketBroker } from "./SocketBroker";
import { normalizeMinioUrl, normalizeOptionalMinioUrl } from "../services/minioClient";
import { setFilterAlertCallback } from "../services/filterService";
import { getSocketAuthClaims } from "./socketAuthentication";

let io: SocketIOServer | null = null;

export const getSocketCorsOrigin = () => {
  const configured = (process.env.ALLOWED_ORIGINS || process.env.APP_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // السماح بالطلبات التي لا تحمل origin (مثل تطبيقات الجوال و curl)
      if (!origin) return callback(null, true);
      if (configured.includes(origin)) return callback(null, true);
      // السماح بـ localhost في بيئات التطوير والاختبار
      if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin not allowed"), false);
    };
  }

  if (process.env.NODE_ENV === "production") {
    // في الإنتاج عند عدم تحديد أصول، يُمنع الاتصال من أي أصل خارجي عشوائي
    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      return callback(new Error("CORS origin not allowed"), false);
    };
  }

  // في بيئة التطوير المحلية
  return true;
};

/**
 * ينشئ ويهيئ خادم Socket.io
 */
export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    path: "/ws",
    transports: ["websocket", "polling"],
    allowUpgrades: true,
    pingInterval: 20000,
    pingTimeout: 180000,
    maxHttpBufferSize: 1e6,
    cors: {
      origin: getSocketCorsOrigin(),
      methods: ["GET", "POST"],
      credentials: true,
    },
    perMessageDeflate: {
      threshold: 2000,
      zlibDeflateOptions: { chunkSize: 1024 * 16, level: 5 },
      zlibInflateOptions: { chunkSize: 1024 * 16 },
    },
  });

  configureSocketGateway(io, { shardId: process.env.SOCKET_SHARD_ID ?? "local" });
  void initializeSocketBroker(io).catch((error) => {
    console.error("[SocketBroker] Initialization failed:", error);
  });

  setFilterAlertCallback((data) => {
    if (io) {
      io.to("moderators_alerts").emit("filter_alert", data);
    }
  });

  // Store io in global and process for cross-context access (Vite sandbox workaround)
  (global as any).__socket_io_instance__ = io;
  (process as any).__socket_io_instance__ = io;

  io.on("connection", async (socket) => {
    const claims = getSocketAuthClaims(socket.handshake.auth);
    if (!claims) {
      console.debug("[socket] connection rejected: missing or invalid signed session", socket.id);
      socket.disconnect(true);
      return;
    }

    const username = claims.username;
    const role = claims.role;
    const userId = claims.sub;
    const handshakeProfileMsg = typeof socket.handshake.auth?.statusMsg === "string" && socket.handshake.auth.statusMsg.trim()
      ? socket.handshake.auth.statusMsg.trim()
      : (typeof socket.handshake.auth?.profileMsg === "string" && socket.handshake.auth.profileMsg.trim()
        ? socket.handshake.auth.profileMsg.trim()
        : "");

    // تحديد كود الدولة الحقيقي بناءً على عنوان الـ IP الخاص بالعضو (مع دعم VPN)
    let detectedCountry = "SA";
    let clientIp = "127.0.0.1";
    try {
      const { getSocketIp, lookupCountryCodeByIp } = await import("../services/requestCountry");
      clientIp = getSocketIp(socket);
      detectedCountry = await lookupCountryCodeByIp(clientIp);
    } catch (e) {
      console.error("Error detecting country code in server/socket/index.ts:", e);
    }

    // التحقق من الحظر عند الاتصال
    try {
      const { checkBan } = await import("../services/banCheck");
      const rawFp = socket.handshake.auth?.deviceFingerprint || socket.handshake.headers?.["x-device-fingerprint"] || "";
      const rawSig = socket.handshake.auth?.deviceSignature || socket.handshake.headers?.["x-device-signature"] || "";
      const deviceFingerprint = Array.isArray(rawFp) ? rawFp[0] : String(rawFp);
      const deviceSignature = Array.isArray(rawSig) ? rawSig[0] : String(rawSig);
      const banResult = await checkBan({
        username,
        ip: clientIp,
        deviceFingerprint,
        deviceSignature,
      });
      if (banResult.banned) {
        const reason = banResult.bans[0]?.reason || "تم حظرك من الموقع";
        socket.emit("system_alert", { title: "حظر", message: reason });
        socket.disconnect(true);
        return;
      }
    } catch (e) {
      console.error("Error checking ban on socket connection:", e);
    }

    // التحقق من تكرار اسم الزائر في الدردشة
    if (role === "guest") {
      try {
        const { isUsernameOnline } = await import("./presenceManager");
        const isOnline = await isUsernameOnline(username, socket.id);
        if (isOnline) {
          socket.emit("system_alert", { title: "تنبيه", message: "هذا الاسم موجود من سابق قم بادخال اسم اخر" });
          socket.disconnect(true);
          return;
        }
      } catch (_) {}
    }

    // حفظ بيانات المستخدم على الـ socket
    socket.data.user = {
      id: userId,
      sessionId: claims.sessionId,
      sessionExpiresAt: claims.exp,
      username,
      displayName: username,
      mentionName: "",
      publicUserId: "",
      role,
      avatar: normalizeMinioUrl(socket.handshake.auth?.avatar || "/pic.png"),
      countryCode: detectedCountry,
      avatarFrameUrl: normalizeOptionalMinioUrl(socket.handshake.auth?.avatarFrameUrl),
      giftIconUrl: normalizeOptionalMinioUrl(socket.handshake.auth?.giftIconUrl),
      memberCardBgUrl: socket.handshake.auth?.memberCardBgUrl || "",
      nameColor: socket.handshake.auth?.nameColor || "",
      messageColor: socket.handshake.auth?.messageColor || "",
      statusFontColor: socket.handshake.auth?.statusFontColor || "",
      messageBubbleStyle: socket.handshake.auth?.messageBubbleStyle || "default",
      status: (["online", "busy", "away"] as const).includes(socket.handshake.auth?.status) ? socket.handshake.auth.status : "online",
      connectedAt: new Date().toISOString(),
      idreg: "",
      siteBadge: socket.handshake.auth?.siteBadge || "",
      profileMsg: handshakeProfileMsg,
      statusMsg: handshakeProfileMsg,
      muted: false,
    };

    // Load profile status, colors and other details from canonical DB sources at connection time
    try {
      const { dbPool } = await import("../db");
      const result = await dbPool.query(
        `SELECT 
           u.idreg, u.uid, u.display_name, u.topic, u.mention_name, u.public_user_id, u.msg, u.pic, u.pich, u.ucol, u.mcol, u.scol, u.muted,
           up.profile_msg, up.avatar_url, up.banner_url, up.avatar_frame_url, up.member_card_bg_url, up.name_color, up.message_color, up.status_font_color,
           up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url, up.muted as profile_muted, up.level, up.exp
         FROM users u
         LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
         WHERE CAST(u.id AS text) = $1 OR CAST(u.uid AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($2) LIMIT 1`,
        [userId, username],
      );
      const row = result.rows[0];
      if (row) {
        const dbDisplayName = (row.display_name || row.topic || username || "").toString().trim();
        socket.data.user.displayName = dbDisplayName;
        socket.data.user.mentionName = (row.mention_name || "").toString().trim();
        socket.data.user.publicUserId = (row.public_user_id || "").toString().trim();
        const dbProfileMsg = (row.profile_msg || row.msg || "").toString().trim();
        const dbIdreg = (row.idreg || "").toString().trim();
        const dbUid = (row.uid || "").toString().trim();
        if (dbProfileMsg) {
          socket.data.user.profileMsg = dbProfileMsg;
          socket.data.user.statusMsg = dbProfileMsg;
        }
        if (dbIdreg) socket.data.user.idreg = dbIdreg;
        if (dbUid && !socket.data.user.idreg) socket.data.user.idreg = dbUid;
        
        const avatar = row.avatar_url || row.pic;
        if (avatar) socket.data.user.avatar = normalizeMinioUrl(avatar);
        
        const cover = row.banner_url || row.pich;
        if (cover) socket.data.user.cover = normalizeMinioUrl(cover);
        
        socket.data.user.avatarFrameUrl = normalizeOptionalMinioUrl(String(row.avatar_frame_url || "").trim());
        socket.data.user.memberCardBgUrl = String(row.member_card_bg_url || "").trim();
        
        socket.data.user.nameColor = String(row.name_color || row.ucol || "").trim();
        socket.data.user.messageColor = String(row.message_color || row.mcol || "").trim();
        socket.data.user.statusFontColor = String(row.status_font_color || row.scol || "").trim();
        
        (socket.data.user as any).giftedBannerUrl = normalizeOptionalMinioUrl(String(row.gifted_banner_url || "").trim());
        (socket.data.user as any).giftedGiftIconUrl = normalizeOptionalMinioUrl(String(row.gifted_gift_icon_url || "").trim());
        (socket.data.user as any).giftedPromotionIconUrl = normalizeOptionalMinioUrl(String(row.gifted_promotion_icon_url || "").trim());

        const mutedValue = row.profile_muted !== undefined ? row.profile_muted : row.muted;
        (socket.data.user as any).muted = Boolean(mutedValue && mutedValue !== 0 && mutedValue !== "0");
        (socket.data.user as any).level = Number(row.level) || 1;
        (socket.data.user as any).exp = Number(row.exp) || 0;

        try {
          const roleResult = await dbPool.query(
            `SELECT r.icon_url AS role_icon_url
             FROM user_role_assignments ura
             JOIN roles r ON r.id = ura.role_id AND r.is_active = true
             WHERE ura.user_id = $1
             ORDER BY r.rank DESC
             LIMIT 1`,
            [userId]
          );
          if (roleResult.rows[0]?.role_icon_url) {
            (socket.data.user as any).roleIconUrl = normalizeOptionalMinioUrl(String(roleResult.rows[0].role_icon_url).trim());
          } else {
            (socket.data.user as any).roleIconUrl = "";
          }
        } catch (_) {
          (socket.data.user as any).roleIconUrl = "";
        }
      }
    } catch (e) {
      console.error("Error fetching user identity on socket connection:", e);
    }
    // Also try in-memory as secondary fallback
    try {
      const { findInMemoryUser } = await import("../services/authService");
      const inMemProfile = findInMemoryUser(userId) || findInMemoryUser(username);
      if (!socket.data.user.statusMsg && inMemProfile?.profile?.profileMsg) {
        const trimmed = String(inMemProfile.profile.profileMsg).trim();
        if (trimmed) socket.data.user.statusMsg = trimmed;
      }
    } catch {}

    // تسجيل أحداث الغرف
    registerSocketConnection(socket, { shardId: process.env.SOCKET_SHARD_ID ?? "local" });
    registerRoomHandlers(io!, socket);
    // تسجيل أحداث الحضور
    registerPresenceHandlers(io!, socket);
    // تسجيل أحداث الرسائل الخاصة
    registerPrivateHandlers(io!, socket);
    // تسجيل أحداث الملف الشخصي
    registerProfileHandlers(io!, socket);
    // تسجيل أحداث القصص
    registerStoryHandlers(io!, socket);
    // تسجيل أحداث الحائط والتعليقات والإعجابات لحظياً
    registerWallHandlers(io!, socket);
    // تسجيل أحداث الإشعارات لحظياً
    registerNotificationHandlers(io!, socket);
    // تسجيل أحداث البريد الداخلي لحظياً
    registerMailHandlers(io!, socket);
    // تسجيل أحداث المنصة الصوتية والمقاعد لحظياً
    registerVoiceStageHandlers(io!, socket);
    // تسجيل أحداث المكالمات الصوتية الخاصة لحظياً (WebRTC 1-on-1)
    registerCallHandlers(io!, socket);

    // إرسال تأكيد الاتصال
    socket.emit("connected", {
      socketId: socket.id,
      user: socket.data.user,
      serverTime: new Date().toISOString(),
    });

    // إرسال حالة الإسكات للمستخدم
    if ((socket.data.user as any).muted) {
      socket.emit("muted_state", { muted: true });
    }

    socket.emit("country_resolved", {
      countryCode: detectedCountry,
    });

    io!.emit("user_country_update", {
      socketId: socket.id,
      userId: socket.data.user.id,
      username: socket.data.user.username,
      role: socket.data.user.role,
      countryCode: detectedCountry,
    });
  });

  return io;
}

/**
 * يحصل على مثيل Socket.io الحالي
 * يتحقق أولاً من المتغير المحلي ثم من المخزن العام (لكسر عزلة Vite sandbox)
 */
export function getIO(): SocketIOServer | null {
  return io || (global as any).__socket_io_instance__ || (process as any).__socket_io_instance__ || (globalThis as any).__socket_io_instance__ || null;
}
