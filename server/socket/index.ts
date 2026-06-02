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

  io.on("connection", async (socket) => {
    const username = socket.handshake.auth?.username || "زائر";
    const role = socket.handshake.auth?.role || "guest";
    const userId = socket.handshake.auth?.userId || socket.id;

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
      avatar: socket.handshake.auth?.avatar || "/pic.png",
      countryCode: detectedCountry,
      avatarFrameUrl: socket.handshake.auth?.avatarFrameUrl || "",
      giftIconUrl: socket.handshake.auth?.giftIconUrl || "",
      messageBubbleStyle: socket.handshake.auth?.messageBubbleStyle || "default",
      status: socket.handshake.auth?.status || "online",
      connectedAt: new Date().toISOString(),
    };

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
 */
export function getIO(): SocketIOServer | null {
  return io;
}
