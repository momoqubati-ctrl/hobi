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
    try {
      const { getSocketIp, lookupCountryCodeByIp } = await import("../services/requestCountry");
      const clientIp = getSocketIp(socket);
      detectedCountry = await lookupCountryCodeByIp(clientIp);
    } catch (e) {
      console.error("Error detecting country code in server/socket/index.ts:", e);
    }

    // حفظ بيانات المستخدم على الـ socket
    socket.data.user = {
      id: userId,
      username,
      role,
      avatar: normalizeMinioUrl(socket.handshake.auth?.avatar || "/pic.png"),
      countryCode: detectedCountry,
      avatarFrameUrl: normalizeMinioUrl(socket.handshake.auth?.avatarFrameUrl || ""),
      giftIconUrl: socket.handshake.auth?.giftIconUrl || "",
      messageBubbleStyle: socket.handshake.auth?.messageBubbleStyle || "default",
      status: socket.handshake.auth?.status || "online",
      connectedAt: new Date().toISOString(),
      idreg: socket.handshake.auth?.idreg || "",
      siteBadge: socket.handshake.auth?.siteBadge || "",
      profileMsg: handshakeProfileMsg,
      statusMsg: handshakeProfileMsg,
    };

    // Load profile status and idreg from the canonical DB source at connection time
    try {
      const { dbPool } = await import("../db");
      const profileResult = await dbPool.query(
        `SELECT "profile_msg", "idreg", "uid", "avatar_url", "banner_url" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
        [userId],
      );
      const profileRow = profileResult.rows[0];
      let legacyRow: any = null;
      if (!profileRow || !String(profileRow.profile_msg || "").trim()) {
        const legacyResult = await dbPool.query(`SELECT "msg", "idreg", "uid", "pic", "pich" FROM "users" WHERE "id" = $1 LIMIT 1`, [userId]);
        legacyRow = legacyResult.rows[0];
      }
      const row = profileRow && String(profileRow.profile_msg || "").trim() ? profileRow : legacyRow || profileRow;
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
        if (row.avatar_url) socket.data.user.avatar = normalizeMinioUrl(row.avatar_url);
        if (row.banner_url) socket.data.user.cover = normalizeMinioUrl(row.banner_url);
        if (!row.avatar_url && legacyRow?.pic) socket.data.user.avatar = normalizeMinioUrl(legacyRow.pic);
        if (!row.banner_url && legacyRow?.pich) socket.data.user.cover = normalizeMinioUrl(legacyRow.pich);
      }
    } catch {}
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
