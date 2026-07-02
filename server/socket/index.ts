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
import { configureSocketGateway, registerSocketConnection } from "./SocketGateway";
import { initializeSocketBroker } from "./SocketBroker";
import { normalizeMinioUrl } from "../services/minioClient";

let io: SocketIOServer | null = null;


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
      origin: "*",
      methods: ["GET", "POST"],
    },
    perMessageDeflate: {
      threshold: 2000,
      zlibDeflateOptions: { chunkSize: 1024 * 16, level: 5 },
      zlibInflateOptions: { chunkSize: 1024 * 16 },
    },
  });

  configureSocketGateway(io, { shardId: process.env.SOCKET_SHARD_ID ?? "local" });
  initializeSocketBroker(io);

  // Store io in global for cross-context access (Vite sandbox workaround)
  (global as any).__socket_io_instance__ = io;

  io.on("connection", async (socket) => {
    // Debug: log incoming handshake auth for tracing (avoid logging secrets)
    try {
      const authSnapshot = { ...socket.handshake.auth };
      console.debug("[socket] connection handshake", socket.id, authSnapshot);
    } catch (e) {}

    const username = socket.handshake.auth?.username || "زائر";
    const role = socket.handshake.auth?.role || "guest";
    const userId = socket.handshake.auth?.userId || socket.id;
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

    // حفظ بيانات المستخدم على الـ socket
    socket.data.user = {
      id: userId,
      username,
      role,
      avatar: normalizeMinioUrl(socket.handshake.auth?.avatar || "/pic.png"),
      countryCode: detectedCountry,
      avatarFrameUrl: socket.handshake.auth?.avatarFrameUrl || "",
      giftIconUrl: socket.handshake.auth?.giftIconUrl || "",
      memberCardBgUrl: socket.handshake.auth?.memberCardBgUrl || "",
      nameColor: socket.handshake.auth?.nameColor || "",
      messageColor: socket.handshake.auth?.messageColor || "",
      messageBubbleStyle: socket.handshake.auth?.messageBubbleStyle || "default",
      status: socket.handshake.auth?.status || "online",
      connectedAt: new Date().toISOString(),
      idreg: socket.handshake.auth?.idreg || "",
      siteBadge: socket.handshake.auth?.siteBadge || "",
      profileMsg: handshakeProfileMsg,
      statusMsg: handshakeProfileMsg,
    };

    // Load profile status, colors and other details from canonical DB sources at connection time
    try {
      const { dbPool } = await import("../db");
      const result = await dbPool.query(
        `SELECT 
           u.idreg, u.uid, u.msg, u.pic, u.pich, u.ucol, u.mcol,
           up.profile_msg, up.avatar_url, up.banner_url, up.avatar_frame_url, up.member_card_bg_url, up.name_color, up.message_color
         FROM users u
         LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
         WHERE CAST(u.id AS text) = $1 LIMIT 1`,
        [userId],
      );
      const row = result.rows[0];
      if (row) {
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
        
        if (row.avatar_frame_url) socket.data.user.avatarFrameUrl = String(row.avatar_frame_url);
        if (row.member_card_bg_url) socket.data.user.memberCardBgUrl = String(row.member_card_bg_url);
        
        socket.data.user.nameColor = String(row.name_color || row.ucol || "").trim();
        socket.data.user.messageColor = String(row.message_color || row.mcol || "").trim();
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

    // إرسال تأكيد الاتصال
    socket.emit("connected", {
      socketId: socket.id,
      user: socket.data.user,
      serverTime: new Date().toISOString(),
    });

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

    socket.on("disconnect", () => {
      // سيتم التعامل مع هذا في presenceHandlers
    });
  });

  return io;
}

/**
 * يحصل على مثيل Socket.io الحالي
 * يتحقق أولاً من المتغير المحلي ثم من المخزن العام (لكسر عزلة Vite sandbox)
 */
export function getIO(): SocketIOServer | null {
  return io || (global as any).__socket_io_instance__ || null;
}
