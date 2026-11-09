/**
 * Vite Plugin: Socket.io Integration
 * يربط Socket.io مع سيرفر Vite Dev عبر HTTP Server hook
 */
import type { Plugin } from "vite";
import { Server as SocketIOServer } from "socket.io";
import { initializeSocketBroker } from "./server/socket/SocketBroker";
import { joinUserChannels } from "./server/socket/SocketChannels";
import { addConnectedUser, removeConnectedUser, joinRoom, leaveRoom } from "./server/socket/presenceManager";
import { registerCallHandlers } from "./server/socket/callHandlers";
import { registerPrivateHandlers } from "./server/socket/privateHandlers";
import { registerProfileHandlers } from "./server/socket/profileHandlers";
import { registerStoryHandlers } from "./server/socket/storyHandlers";
import { registerWallHandlers } from "./server/socket/wallHandlers";
import { registerNotificationHandlers } from "./server/socket/notificationHandlers";
import { registerMailHandlers } from "./server/socket/mailHandlers";
import { registerVoiceStageHandlers } from "./server/socket/voiceStageHandlers";
import { isPresenceBridgeAuthorized } from "./server/socket/presenceBridge";
import { privateMessageStore, registerPrivateMessageSession } from "./server/services/privateMessageService";
import { normalizeMinioUrl, normalizeOptionalMinioUrl } from "./server/services/minioClient";
import { getSocketAuthClaims } from "./server/socket/socketAuthentication";

export function viteSocketIO(): Plugin {
  let io: SocketIOServer | null = null;

  return {
    name: "vite-plugin-socket-io",
    configureServer(server) {
      if (!server.httpServer) return;

      console.log(`[SOCKET_TRACE_VITE] configuring pid=${process.pid}`);
      (globalThis as any).__VITE_SOCKET_IO_CREATED__ = true;
      (process as any).__VITE_SOCKET_IO_CREATED__ = true;

      io = new SocketIOServer(server.httpServer, {
        path: "/ws",
        serveClient: false,
        transports: ["websocket", "polling"],
        allowUpgrades: true,
        pingInterval: 25000,     // ping كل 25 ثانية (يتناسب مع keepalive العميل 25s)
        pingTimeout: 300000,     // 5 دقائق — يحمي المستخدمين الذين يتركون الهاتف فترة طويلة
        maxHttpBufferSize: 5e6,
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
      console.log(`[SOCKET_TRACE_VITE] attached: upgradeListeners=${(server.httpServer as any).listenerCount("upgrade")}`);

      // ===== تتبّع مؤقت: اعتراض engine.io close لكل سوكت مع سبب الاستدعاء =====
      (io.engine as any).on("connection", (engineSocket: any) => {
        const originalClose = engineSocket.close.bind(engineSocket);
        engineSocket.close = function (discard?: boolean) {
          const stack = (new Error().stack || "").split("\n").slice(2, 8).join(" | ");
          console.log(`[SOCKET_TRACE_ENGINE_CLOSE] sid=${engineSocket.id} discard=${discard} path=${engineSocket.request?.url || ""} stack=${stack}`);
          return originalClose(discard);
        } as typeof engineSocket.close;
        engineSocket.on("close", (reason: string) => {
          console.log(`[SOCKET_TRACE_ENGINE_EVENT] sid=${engineSocket.id} engineCloseReason=${reason}`);
        });
      });

      // Initialize the SocketBroker with this io instance
      void initializeSocketBroker(io).catch((error) => {
        console.error("[SocketBroker] Initialization failed:", error);
      });
      (globalThis as any).__socket_io_instance__ = io;
      (process as any).__socket_io_instance__ = io;

      if (io) {
        for (const [_, s] of io.sockets.sockets) {
          try {
            registerPrivateHandlers(io, s);
          } catch (_) {}
        }
      }

      // Expose room member counts as JSON endpoint for Nitro to consume
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === "/__presence_users__" && req.method === "GET") {
          if (!isPresenceBridgeAuthorized(req.headers["x-internal-presence-token"])) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false }));
            return;
          }

          const users = Array.from(connectedUsers.values(), (user) => ({
            id: String(user.id),
            role: String(user.role),
            roomId: String(user.roomId || ""),
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(users));
          return;
        }

        if (req.url === "/__publish_user_event__" && req.method === "POST") {
          if (!isPresenceBridgeAuthorized(req.headers["x-internal-presence-token"])) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false }));
            return;
          }

          let body = "";
          let bodyTooLarge = false;
          req.on("data", (chunk: Buffer | string) => {
            if (bodyTooLarge) return;
            body += chunk.toString();
            if (Buffer.byteLength(body) > 1_000_000) {
              bodyTooLarge = true;
              res.writeHead(413, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false }));
            }
          });
          req.on("end", () => {
            if (bodyTooLarge) return;
            try {
              const payload = JSON.parse(body || "{}");
              const allowedEvents = new Set([
                "announcement:created",
                "voice_stage:signal",
                "voice_stage:kicked_from_seat",
              ]);
              if (
                typeof payload.userId !== "string" ||
                !payload.userId.trim() ||
                typeof payload.event !== "string" ||
                !allowedEvents.has(payload.event)
              ) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false }));
                return;
              }

              const userId = payload.userId.trim();
              const roomSocketIds = io!.sockets.adapter.rooms.get(`user:${userId}`);
              const matchingSocketIds = Array.from(connectedUsers.entries())
                .filter(([, user]) => String(user.id) === userId)
                .map(([socketId]) => socketId);
              const targetSocketIds = new Set([
                ...(roomSocketIds ?? []),
                ...matchingSocketIds,
              ]);
              if (typeof payload.excludeSocketId === "string") {
                targetSocketIds.delete(payload.excludeSocketId);
              }
              for (const socketId of targetSocketIds) {
                io!.to(socketId).emit(payload.event, payload.payload);
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, emittedTo: targetSocketIds.size }));
            } catch (error) {
              console.error("[vite-socket] Internal user event bridge failed:", error);
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false }));
            }
          });
          return;
        }

        if (req.url === "/__pm_stage_media__" && req.method === "POST") {
          if (!isPresenceBridgeAuthorized(req.headers["x-internal-presence-token"])) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "جلسة غير صالحة" }));
            return;
          }

          const sessionIdStage = String(req.headers["x-pm-session-id"] || "").trim();
          const sessionExpiresAtStage = Number(req.headers["x-pm-session-expires-at"]);
          const userIdStage = String(req.headers["x-pm-user-id"] || "").trim();
          const recipientIdStage = String(req.headers["x-pm-recipient-id"] || "").trim();
          const contentTypeStage = String(req.headers["x-pm-content-type"] || "").trim();
          const mediaTypeStage = String(req.headers["x-pm-media-type"] || "").trim();
          const isStageMediaType = ["image", "video", "audio", "file"].includes(mediaTypeStage);
          if (!sessionIdStage || !userIdStage || !recipientIdStage || !contentTypeStage ||
              !isStageMediaType || !Number.isFinite(sessionExpiresAtStage)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "بيانات الوسيط غير صالحة" }));
            return;
          }

          const stageChunks: Buffer[] = [];
          let stagedBytes = 0;
          let stageTooLarge = false;
          req.on("data", (chunk: Buffer) => {
            if (stageTooLarge) return;
            stagedBytes += chunk.length;
            if (stagedBytes > 64 * 1024 * 1024) {
              stageTooLarge = true;
              res.writeHead(413, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "حجم الملف يتجاوز الحد المسموح" }));
              return;
            }
            stageChunks.push(chunk);
          });
          req.on("end", () => {
            if (stageTooLarge) return;
            try {
              const bytes = Buffer.concat(stageChunks);
              registerPrivateMessageSession({
                sessionId: sessionIdStage,
                userId: userIdStage,
                expiresAt: sessionExpiresAtStage,
              });
              const stageResult = privateMessageStore.stageMedia({
                sessionId: sessionIdStage,
                receiverId: recipientIdStage,
                contentType: contentTypeStage,
                mediaType: mediaTypeStage as "image" | "video" | "audio" | "file",
                bytes,
              });
              if (!stageResult) {
                res.writeHead(409, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "تعذر إرسال الوسيط؛ يرجى التحقق من الملف وحالة الاتصال والمحاولة مرة أخرى" }));
                return;
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ bridge: "pm-media", success: true, mediaId: stageResult }));
            } catch (error) {
              console.error("[vite-socket] Internal PM media staging failed:", error);
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "تعذر إرسال الوسيط" }));
            }
          });
          return;
        }

        const pmMediaMatch = /^\/__pm_media__\/([A-Za-z0-9_-]{8,128})$/.exec(req.url || "");
        if (pmMediaMatch && req.method === "GET") {
          if (!isPresenceBridgeAuthorized(req.headers["x-internal-presence-token"])) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "جلسة غير صالحة" }));
            return;
          }
          const mediaSessionId = String(req.headers["x-pm-session-id"] || "").trim();
          if (!mediaSessionId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "جلسة غير صالحة" }));
            return;
          }
          try {
            const media = privateMessageStore.getMedia(mediaSessionId, pmMediaMatch[1]);
            if (!media) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "الوسيط غير موجود أو انتهت صلاحيته" }));
              return;
            }
            res.writeHead(200, {
              "Content-Type": media.contentType,
              "Content-Length": String(media.bytes.length),
            });
            res.end(media.bytes);
          } catch (error) {
            console.error("[vite-socket] Internal PM media fetch failed:", error);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bridge: "pm-media", success: false, message: "تعذر تحميل الوسيط" }));
          }
          return;
        }

        if (req.url === '/__room_counts__') {
          const counts: Record<string, number> = {};
          // Use Socket.IO adapter rooms as source of truth (shared across all io instances)
          if (io) {
            const adapterRooms = io.sockets.adapter.rooms;
            for (const [name, s] of adapterRooms.entries()) {
              if (name.startsWith('room:')) {
                counts[name.slice(5)] = s.size;
              }
            }
          }
          // Fallback: also include roomMembersMap entries not yet in adapter
          for (const [roomId, members] of roomMembersMap.entries()) {
            if (counts[roomId] === undefined) {
              counts[roomId] = members.size;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(counts));
          return;
        }
        next();
      });

      // Room Handlers (profile, roles)
      let roomHandlers: any;
      import("./server/socket/roomHandlers").then(m => { roomHandlers = m; }).catch(e => console.error("[vite-socket] Failed to load roomHandlers:", e));

      // ========== Presence Manager (inline) ==========
      type OnlineUser = {
        id: string;
        socketId: string;
        sessionId?: string;
        sessionExpiresAt?: number;
        username: string;
        role: string;
        avatar: string;
        countryCode: string;
        avatarFrameUrl: string;
        giftIconUrl: string;
        memberCardBgUrl: string;
        nameColor: string;
        messageColor: string;
        statusFontColor: string;
        messageBubbleStyle: string;
        roomId: string;
        connectedAt: string;
        status: "online" | "idle" | "busy" | "away";
        idreg?: string;
        siteBadge?: string;
        statusMsg?: string;
        giftedBannerUrl?: string;
        giftedGiftIconUrl?: string;
        giftedPromotionIconUrl?: string;
        roleIconUrl?: string;
      };

      const connectedUsers = new Map<string, OnlineUser>();
      const roomMembersMap = new Map<string, Set<string>>();
      const pendingLeaves = new Map<string, { roomId: string; timeout: NodeJS.Timeout }>();
      const pendingDisconnects = new Map<string, { roomId: string; timeout: NodeJS.Timeout; socketId: string; userId: string }>();
      const runtimeGlobal = globalThis as typeof globalThis & {
        __vite_connected_users__?: Map<string, OnlineUser>;
        __vite_room_members_map__?: Map<string, Set<string>>;
      };
      const runtimeProcess = process as NodeJS.Process & {
        __vite_connected_users__?: Map<string, OnlineUser>;
        __vite_room_members_map__?: Map<string, Set<string>>;
      };
      runtimeGlobal.__vite_connected_users__ = connectedUsers;
      runtimeGlobal.__vite_room_members_map__ = roomMembersMap;
      runtimeProcess.__vite_connected_users__ = connectedUsers;
      runtimeProcess.__vite_room_members_map__ = roomMembersMap;
      console.log("[VITE_TRACE_PRESENCE] Exposed connectedUsers and roomMembersMap on runtime globals");

      // عدّاد فريد: يحسب الأشخاص الفعليين لا الجلسات (يمنع تضخم "متصل الآن" عند تعدد الجلسات أو بقاياها)
      function computeUniqueOnlineCount(): number {
        const seen = new Set<string>();
        for (const u of connectedUsers.values()) {
          const id = String(u.id || "").trim();
          if (id && id !== "0") {
            seen.add(`id:${id}`);
            continue;
          }
          const name = String(u.username || "").trim().toLowerCase();
          if (name && u.role !== "guest") {
            seen.add(`username:${name}`);
          } else {
            seen.add(`socket:${u.socketId}`);
          }
        }
        return seen.size;
      }

      const normalizeOnlineUserAssets = (user: OnlineUser): OnlineUser => ({
        ...user,
        avatar: normalizeMinioUrl(user.avatar || "/pic.png"),
        avatarFrameUrl: normalizeOptionalMinioUrl(user.avatarFrameUrl),
        giftIconUrl: normalizeOptionalMinioUrl(user.giftIconUrl),
        memberCardBgUrl: normalizeOptionalMinioUrl(user.memberCardBgUrl),
        giftedBannerUrl: normalizeOptionalMinioUrl(user.giftedBannerUrl),
        giftedGiftIconUrl: normalizeOptionalMinioUrl(user.giftedGiftIconUrl),
        giftedPromotionIconUrl: normalizeOptionalMinioUrl(user.giftedPromotionIconUrl),
        roleIconUrl: normalizeOptionalMinioUrl(user.roleIconUrl),
      });

      function addUser(socketId: string, data: Omit<OnlineUser, "socketId">) {
        connectedUsers.set(socketId, { ...data, socketId } as OnlineUser);
      }

      function broadcastUserConnected(user: OnlineUser) {
        const assets = normalizeOnlineUserAssets(user);
        io!.emit("user_connected", {
          socketId: user.socketId,
          userId: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          mentionName: user.mentionName || "",
          publicUserId: user.publicUserId || "",
          role: user.role,
          countryCode: user.countryCode,
          avatar: assets.avatar,
          avatarFrameUrl: assets.avatarFrameUrl,
          giftIconUrl: assets.giftIconUrl,
          memberCardBgUrl: assets.memberCardBgUrl,
          nameColor: user.nameColor,
          messageColor: user.messageColor,
          roomId: user.roomId,
          status: user.status,
          idreg: user.idreg,
          siteBadge: user.siteBadge,
          statusMsg: user.statusMsg || "",
          giftedBannerUrl: assets.giftedBannerUrl,
          giftedGiftIconUrl: assets.giftedGiftIconUrl,
          giftedPromotionIconUrl: assets.giftedPromotionIconUrl,
          roleIconUrl: assets.roleIconUrl,
          count: computeUniqueOnlineCount(),
        });
      }

      function broadcastUserDisconnected(user: OnlineUser) {
        io!.emit("user_disconnected", {
          socketId: user.socketId,
          userId: user.id,
          username: user.username,
          role: user.role,
          count: computeUniqueOnlineCount(),
        });
      }

      function removeUser(socketId: string) {
        const user = connectedUsers.get(socketId);
        if (user) {
          console.log(`[VITE_TRACE_ROOM] removeUser START socketId=${socketId} user=${user.username} roomId=${user.roomId} roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))}`);
          connectedUsers.delete(socketId);
          if (user.roomId) {
            const members = roomMembersMap.get(user.roomId);
            if (members) {
              members.delete(socketId);
              if (members.size === 0) {
                roomMembersMap.delete(user.roomId);
                console.log(`[VITE_TRACE_ROOM] removeUser: roomMembersMap DELETED key ${user.roomId} (became empty)`);
              }
            }
          }
          console.log(`[VITE_TRACE_ROOM] removeUser END socketId=${socketId} user=${user.username} roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))}`);
          removeConnectedUser(socketId).catch(err => console.error("[vite-socket] removeConnectedUser failed:", err));
        } else {
          console.log(`[VITE_TRACE_ROOM] removeUser: user NOT FOUND socketId=${socketId}`);
        }
        return user;
      }

      function joinUserToRoom(socketId: string, roomId: string) {
        const user = connectedUsers.get(socketId);
        if (!user) {
          console.log(`[VITE_TRACE_ROOM] joinUserToRoom: user NOT FOUND socketId=${socketId} roomId=${roomId}`);
          return;
        }
        console.log(`[VITE_TRACE_ROOM] joinUserToRoom START socketId=${socketId} roomId=${roomId} user.roomId=${user.roomId} roomMembersMap.has(roomId)=${roomMembersMap.has(roomId)} currentCount=${getRoomCount(roomId)}`);
        if (user.roomId && user.roomId !== roomId) {
          leaveUserFromRoom(socketId);
        }
        user.roomId = roomId;
        if (!roomMembersMap.has(roomId)) roomMembersMap.set(roomId, new Set());
        roomMembersMap.get(roomId)!.add(socketId);
        console.log(`[VITE_TRACE_ROOM] joinUserToRoom END socketId=${socketId} roomId=${roomId} count=${getRoomCount(roomId)} roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))}`);
        joinRoom(socketId, roomId).catch(err => console.error("[vite-socket] joinRoom failed:", err));
      }

      function leaveUserFromRoom(socketId: string) {
        const user = connectedUsers.get(socketId);
        if (!user || !user.roomId) {
          console.log(`[VITE_TRACE_ROOM] leaveUserFromRoom: no user or no roomId socketId=${socketId} user=${!!user}`);
          return undefined;
        }
        const roomId = user.roomId;
        const members = roomMembersMap.get(roomId);
        const beforeCount = members?.size ?? 0;
        console.log(`[VITE_TRACE_ROOM] leaveUserFromRoom START socketId=${socketId} roomId=${roomId} beforeCount=${beforeCount} user.roomId=${user.roomId}`);
        console.log(`[VITE_TRACE_ROOM] CALLER: ${new Error().stack?.split('\n').slice(2, 6).join(' → ')}`);
        if (members) {
          members.delete(socketId);
          if (members.size === 0) {
            roomMembersMap.delete(roomId);
            console.log(`[VITE_TRACE_ROOM] leaveUserFromRoom: roomMembersMap deleted key roomId=${roomId} (became empty)`);
          }
        }
        user.roomId = "";
        const s = io?.sockets.sockets.get(socketId);
        if (s) s.data.user.roomId = "";
        console.log(`[VITE_TRACE_ROOM] leaveUserFromRoom END socketId=${socketId} removedFrom=${roomId} countAfter=${getRoomCount(roomId)} roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))}`);
        leaveRoom(socketId).catch(err => console.error("[vite-socket] leaveRoom failed:", err));
        return roomId;
      }

      function getRoomUsers(roomId: string): OnlineUser[] {
        const memberIds = roomMembersMap.get(roomId);
        if (!memberIds) return [];
        const result: OnlineUser[] = [];
        for (const sid of memberIds) {
          const u = connectedUsers.get(sid);
          if (u) result.push(u);
        }
        return result;
      }

      function getRoomCount(roomId: string) {
        return roomMembersMap.get(roomId)?.size ?? 0;
      }

      // ========== Real DB Message Store via chatStore ==========
      let chatStore: any;
      import("./server/services/chatStore").then(m => { chatStore = m; });
      let powersService: any;
      import("./server/services/powersService").then(m => { powersService = m; });
      let filterService: any;
      import("./server/services/filterService").then(m => { filterService = m; });
      let shortcutService: any;
      import("./server/services/shortcutService").then(m => { shortcutService = m; });
      let requestCountry: any;
      import("./server/services/requestCountry").then(m => { requestCountry = m; });

      // ========== Typing throttle ==========
      const typingTimers = new Map<string, NodeJS.Timeout>();

      // ========== Socket.io Connection Handler ==========
      io.on("connection", (socket) => {
        const auth = socket.handshake.auth || {};
        const claims = getSocketAuthClaims(auth);

        if (!claims) {
          console.debug("[vite-socket] rejecting unauthenticated socket connection:", socket.id);
          socket.disconnect(true);
          return;
        }

        let username = claims.username;
        const role = claims.role;
        const userId = claims.sub;

        // Synchronously initialize socket.data.user so handlers like profileHandlers capture a valid user
        const initialUserData: Omit<OnlineUser, "socketId"> = {
          id: userId,
          sessionId: claims.sessionId,
          sessionExpiresAt: claims.exp,
          username,
          displayName: (typeof auth.displayName === "string" && auth.displayName.trim()) || (typeof auth.name === "string" && auth.name.trim()) || username,
          mentionName: (typeof auth.mentionName === "string" && auth.mentionName.trim()) || "",
          publicUserId: (typeof auth.publicUserId === "string" && auth.publicUserId.trim()) || "",
          role,
          avatar: auth.avatar || "/pic.png",
          countryCode: auth.countryCode || "SA",
          avatarFrameUrl: auth.avatarFrameUrl || "",
          giftIconUrl: auth.giftIconUrl || "",
          memberCardBgUrl: auth.memberCardBgUrl || "",
          nameColor: auth.nameColor || "",
          messageColor: auth.messageColor || "",
          messageBubbleStyle: auth.messageBubbleStyle || "default",
          statusFontColor: auth.statusFontColor || "",
          roomId: "",
          connectedAt: new Date().toISOString(),
          status: "online",
          idreg: auth.idreg || "",
          siteBadge: auth.siteBadge || "",
          statusMsg: (typeof auth.statusMsg === "string" && auth.statusMsg.trim()) || (typeof auth.profileMsg === "string" && auth.profileMsg.trim()) || "",
          giftedBannerUrl: auth.giftedBannerUrl || "",
          giftedGiftIconUrl: auth.giftedGiftIconUrl || "",
          giftedPromotionIconUrl: auth.giftedPromotionIconUrl || "",
          roleIconUrl: auth.roleIconUrl || "",
        };
        socket.data.user = initialUserData;
        let userData: Omit<OnlineUser, "socketId"> = initialUserData;
        addUser(socket.id, initialUserData);

        (async () => {
          let canonicalDisplayName = initialUserData.displayName;
          let canonicalMentionName = initialUserData.mentionName;
          let canonicalPublicUserId = initialUserData.publicUserId;
          let dbIdreg = auth.idreg || "";
          let dbNameColor = auth.nameColor || "";
          let dbMessageColor = auth.messageColor || "";
          let dbMemberCardBg = auth.memberCardBgUrl || "";
          let dbAvatarFrame = auth.avatarFrameUrl || "";
          let dbStatusMsg = typeof auth.statusMsg === "string" && auth.statusMsg.trim()
            ? auth.statusMsg.trim()
            : (typeof auth.profileMsg === "string" && auth.profileMsg.trim() ? auth.profileMsg.trim() : "");
          let dbGiftedBannerUrl = auth.giftedBannerUrl || "";
          let dbGiftedGiftIconUrl = auth.giftedGiftIconUrl || "";
          let dbGiftedPromotionIconUrl = auth.giftedPromotionIconUrl || "";
          let dbRoleIconUrl = auth.roleIconUrl || "";

          try {
            const mod = await import("./server/db");
            const result = await mod.dbPool.query(
              `SELECT u.id, u.username, u.display_name, u.topic, u.mention_name, u.public_user_id, u.idreg, u.ucol, u.mcol,
                      up.member_card_bg_url, up.name_color, up.message_color, up.idreg as up_idreg, up.avatar_frame_url, up.profile_msg,
                      up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url
               FROM users u
               LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
               WHERE CAST(u.id AS text) = $1 OR CAST(u.uid AS text) = $1 OR CAST(u.idreg AS text) = $1 OR lower(u.username) = lower($2)
               LIMIT 1`,
              [userId, username]
            );
            const row = result.rows[0];
            if (row) {
              canonicalDisplayName = String(row.display_name || row.topic || username).trim();
              canonicalMentionName = String(row.mention_name || "").trim();
              canonicalPublicUserId = String(row.public_user_id || "").trim();
              if (row.member_card_bg_url) dbMemberCardBg = String(row.member_card_bg_url).trim();
              if (row.name_color || row.ucol) dbNameColor = String(row.name_color || row.ucol).trim();
              if (row.message_color || row.mcol) dbMessageColor = String(row.message_color || row.mcol).trim();
              if (row.up_idreg || row.idreg) dbIdreg = String(row.up_idreg || row.idreg).trim();
              if (row.avatar_frame_url) dbAvatarFrame = String(row.avatar_frame_url).trim();
              if (row.gifted_banner_url) dbGiftedBannerUrl = String(row.gifted_banner_url).trim();
              if (row.gifted_gift_icon_url) dbGiftedGiftIconUrl = String(row.gifted_gift_icon_url).trim();
              if (row.gifted_promotion_icon_url) dbGiftedPromotionIconUrl = String(row.gifted_promotion_icon_url).trim();
              if (row.profile_msg) dbStatusMsg = String(row.profile_msg).trim();
            }

            const roleResult = await mod.dbPool.query(
              `SELECT r.icon_url AS role_icon_url
               FROM user_role_assignments ura
               JOIN roles r ON r.id = ura.role_id AND r.is_active = true
               WHERE ura.user_id = $1
               ORDER BY r.rank DESC
               LIMIT 1`,
              [userId]
            );
            if (roleResult.rows[0]?.role_icon_url) {
              dbRoleIconUrl = normalizeOptionalMinioUrl(roleResult.rows[0].role_icon_url);
            }
          } catch (dbErr) {
            console.error("[vite-socket] Error querying canonical user info from DB:", dbErr);
          }

          userData = {
            id: userId,
            sessionId: claims.sessionId,
            sessionExpiresAt: claims.exp,
            username,
            displayName: canonicalDisplayName,
            mentionName: canonicalMentionName,
            publicUserId: canonicalPublicUserId,
            role,
            avatar: auth.avatar || "/pic.png",
            countryCode: auth.countryCode || "SA",
            avatarFrameUrl: dbAvatarFrame,
            giftIconUrl: auth.giftIconUrl || "",
            memberCardBgUrl: dbMemberCardBg,
            nameColor: dbNameColor,
            messageColor: dbMessageColor,
            messageBubbleStyle: auth.messageBubbleStyle || "default",
            statusFontColor: auth.statusFontColor || "",
            roomId: "",
            connectedAt: new Date().toISOString(),
            status: "online",
            idreg: dbIdreg,
            siteBadge: auth.siteBadge || "",
            statusMsg: dbStatusMsg,
            giftedBannerUrl: dbGiftedBannerUrl,
            giftedGiftIconUrl: dbGiftedGiftIconUrl,
            giftedPromotionIconUrl: dbGiftedPromotionIconUrl,
            roleIconUrl: dbRoleIconUrl,
          };

          socket.data.user = userData;
          console.log(`[VITE_TRACE_PRESENCE] new connection socketId=${socket.id} username=${username} displayName=${canonicalDisplayName} userId=${userId}`);
          addUser(socket.id, userData);
          addConnectedUser(socket.id, userData).catch(err => console.error("[vite-socket] addConnectedUser failed:", err));

          joinUserChannels(socket);
          try {
            registerPrivateHandlers(io!, socket);
          } catch (pmErr) {
            console.error("[vite-socket] registerPrivateHandlers async failed:", pmErr);
          }

          const connectedUser = connectedUsers.get(socket.id)!;
          broadcastUserConnected(connectedUser);
          io!.emit("online_count", { count: computeUniqueOnlineCount() });

          if (role === 'admin' || role === 'owner') {
            socket.join("moderators_alerts");
          }

          socket.emit("connected", {
            socketId: socket.id,
            user: userData,
            serverTime: new Date().toISOString(),
          });
        })();

        // Update country from IP asynchronously
        if (requestCountry) {
          const socketIp = requestCountry.getSocketIp(socket);
          requestCountry.lookupCountryCodeByIp(socketIp).then((cc: string) => {
            if (cc) {
              const u = connectedUsers.get(socket.id);
              if (u) {
                u.countryCode = cc;
                io!.emit("user_country_update", {
                  socketId: socket.id,
                  userId: u.id,
                  username: u.username,
                  displayName: u.displayName || u.username,
                  mentionName: u.mentionName || "",
                  publicUserId: u.publicUserId || "",
                  role: u.role,
                  countryCode: cc,
                });
                socket.emit("country_resolved", {
                  countryCode: cc,
                });
              }
            }
          }).catch((err: any) => console.error("IP Lookup error:", err));
        }

        // ===== Room Events =====
        socket.on("join_room", async (data: any, callback?: any) => {
          const roomId = String(data?.roomId || "").trim();
          if (!roomId) { callback?.({ success: false, message: "معرف الغرفة مطلوب" }); return; }

          // ── فحص الطرد المؤقت ──
          try {
            const mod = await import("./server/db");
            const uid = String(userData.id || "");
            const uname = String(userData.username || "").toLowerCase();
            const uidreg = String(userData.idreg || "");

            const kickRes = await mod.dbPool.query(
              `WITH user_identifiers AS (
                 SELECT 
                   CAST(id AS text) as id_val,
                   CAST(uid AS text) as uid_val,
                   CAST(idreg AS varchar) as idreg_val
                 FROM users 
                 WHERE lower(username) = lower($4)
                    OR CAST(id AS text) = $2
                    OR CAST(uid AS text) = $2
                    OR CAST(idreg AS varchar) = $3
                 LIMIT 1
               )
               SELECT k.banned_until, k.user_id, k.room_id 
               FROM room_kicks k, user_identifiers u
               WHERE k.room_id = $1 
                 AND (
                   k.user_id = u.id_val
                   OR k.user_id = u.uid_val
                   OR k.user_id = u.idreg_val
                   OR k.user_id = $2
                   OR k.user_id = $3
                   OR lower(k.user_id) = lower($4)
                 )
               ORDER BY k.banned_until DESC
               LIMIT 1`,
              [roomId, uid, uidreg, uname]
            );
            if (kickRes.rows.length > 0) {
              const bannedUntil = new Date(kickRes.rows[0].banned_until);
              const remaining = bannedUntil.getTime() - Date.now();
              if (remaining > 0) {
                const diffMins = Math.floor(remaining / 60000);
                const diffSecs = Math.floor((remaining % 60000) / 1000);
                const timeStr = diffMins > 0 ? `${diffMins} دقيقة و ${diffSecs} ثانية` : `${diffSecs} ثانية`;
                callback?.({ success: false, message: `لا يمكنك الدخول للغرفة، تم طردك مؤقتاً ومتبقي لديك ${timeStr}` });
                return;
              }
            }
          } catch (e) {
            console.error("Room kick check error (dev):", e);
          }

          const pendingLeave = pendingLeaves.get(socket.id);
          let prev = connectedUsers.get(socket.id)?.roomId;
          console.log(`[VITE_TRACE] join_room START user=${username} socket=${socket.id} roomId=${roomId} prev=${prev} pendingLeave=${!!pendingLeave} connectedUsers.size=${connectedUsers.size} roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))}`);
          
          if (pendingLeave) {
            clearTimeout(pendingLeave.timeout);
            prev = pendingLeave.roomId;
            pendingLeaves.delete(socket.id);
            console.log(`[VITE_TRACE] pendingLeave resolved: prev=${prev}`);
          }

          // البحث عن معلّقات قطع اتصال لهذه الجلسة أو لأي جلسة سابقة لنفس المستخدم
          // (المفاتيح الآن socketId لكل جلسة — نمسح البنية بدلاً من المفتاح المباشر)
          let isReconnect = false;

          for (const [pKey, pEntry] of Array.from(pendingDisconnects.entries())) {
            const isOwn = pKey === socket.id || pEntry.socketId === socket.id;
            const isSameUser = String(pEntry.userId || "") === String(userId);
            if (!isOwn && !isSameUser) continue;

            clearTimeout(pEntry.timeout);
            pendingDisconnects.delete(pKey);

            const oldSocketId = pEntry.socketId;
            if (oldSocketId !== socket.id) {
              removeUser(oldSocketId);
              console.log(`[VITE_TRACE] pendingDisconnect: removed OLD socket oldSocketId=${oldSocketId} (different from current)`);
            } else {
              console.log(`[VITE_TRACE] pendingDisconnect: SKIPPED removeUser (same socket) oldSocketId=${oldSocketId}`);
            }

            if (pEntry.roomId === roomId) {
              isReconnect = true;
              console.log(`[VITE_TRACE] isReconnect=true (same room) roomId=${roomId}`);
            } else {
              prev = pEntry.roomId;
              console.log(`[VITE_TRACE] pendingDisconnect: setting prev=${prev} oldSocketId=${oldSocketId} roomId=${roomId}`);
            }
          }

          // Resolve room names and images for system messages
          let roomName = roomId;
          let roomImage = "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop";
          let prevRoomName = prev || "";
          try {
            const rooms = await chatStore.listRooms();
            const currentRoom = rooms.find((r: any) => r.id === roomId);
            if (currentRoom) {
              roomName = currentRoom.name;
              roomImage = currentRoom.image || roomImage;
            }
            if (prev) {
              const oldRoom = rooms.find((r: any) => r.id === prev);
              if (oldRoom) prevRoomName = oldRoom.name;
            }
          } catch (e) {
            console.error("Error listing rooms for join_room name resolver:", e);
          }

          if (prev && prev !== roomId) {
            console.log(`[VITE_TRACE] === TRANSITION user=${username} socket=${socket.id} from=${prev} to=${roomId} ===`);
            console.log(`[VITE_TRACE] before leave: prevRoom=${prev} getRoomCount=${getRoomCount(prev)} roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))} roomMembersMap[${prev}]=${JSON.stringify(Array.from(roomMembersMap.get(prev) || []))}`);
            
            socket.leave(`room:${prev}`);
            leaveUserFromRoom(socket.id);
            
            const countAfterLeave = getRoomCount(prev);
            console.log(`[VITE_TRACE] after leave: prevRoom=${prev} getRoomCount=${countAfterLeave} roomMembersMap[${prev}]=${JSON.stringify(Array.from(roomMembersMap.get(prev) || []))}`);
            
            io!.to(`room:${prev}`).emit("user_left", { socketId: socket.id, username, roomId: prev, memberCount: countAfterLeave });
            
            // Broadcast transition message to previous room
            io!.to(`room:${prev}`).emit("system_message", {
              text: `قام بالانتقال إلى الغرفة: ${roomName}`,
              roomId: prev,
              systemType: "transition",
              user: {
                id: userData.id,
                username: userData.username,
                role: userData.role,
                avatar: userData.avatar,
                countryCode: userData.countryCode,
                avatarFrameUrl: userData.avatarFrameUrl,
                giftIconUrl: userData.giftIconUrl,
              },
              targetRoom: {
                id: roomId,
                name: roomName,
                image: roomImage,
              }
            });
            
            // Broadcast live counter update globally for the previous room
            io!.emit("room_count_update", { roomId: prev, memberCount: countAfterLeave });
          } else {
            console.log(`[VITE_TRACE] NO TRANSITION (first join or same room) user=${username} socket=${socket.id} room=${roomId} prev=${prev}`);
          }

          socket.join(`room:${roomId}`);
          joinUserToRoom(socket.id, roomId);
          socket.data.user.roomId = roomId;

          const members = getRoomUsers(roomId);
          console.log(`[VITE_TRACE] after join: newRoom=${roomId} getRoomUsers=${members.length} getRoomCount=${getRoomCount(roomId)} roomMembersMap[${roomId}]=${JSON.stringify(Array.from(roomMembersMap.get(roomId) || []))} memberIds=${JSON.stringify(members.map(m=>({id:m.id, uname:m.username, sid:m.socketId})))}`);
          
          try {
            const messages = await chatStore.listMessages(roomId);
            const rooms = await chatStore.listRooms();
            const room = rooms.find((r: any) => r.id === roomId);

            // Batch fetch member levels, exp, idreg
            const memberIds = members.map(m => String(m.id)).filter(Boolean);
            const memberProfilesMap = new Map<string, any>();
            if (memberIds.length > 0) {
              try {
                const mod = await import("./server/db");
                const profRes = await mod.dbPool.query(
                  `SELECT user_id, level, exp, idreg FROM user_profiles WHERE user_id = ANY($1::text[])`,
                  [memberIds]
                );
                for (const row of profRes.rows) {
                  memberProfilesMap.set(String(row.user_id), row);
                }
                const usersRes = await mod.dbPool.query(
                  `SELECT id, idreg, username FROM users WHERE id::text = ANY($1::text[])`,
                  [memberIds]
                );
                for (const row of usersRes.rows) {
                  const existing = memberProfilesMap.get(String(row.id)) || {};
                  if (row.idreg) existing.idreg = String(row.idreg);
                  memberProfilesMap.set(String(row.id), existing);
                }
              } catch (_) {}
            }

            const mappedMembers = members.map(m => {
              const p = memberProfilesMap.get(String(m.id));
              const mIdreg = String(p?.idreg || m.idreg || "").replace(/^#+/, "");
              return {
                id: m.id,
                username: m.username,
                role: m.role,
                avatar: m.avatar,
                countryCode: m.countryCode,
                avatarFrameUrl: m.avatarFrameUrl,
                giftIconUrl: m.giftIconUrl,
                status: m.status || "online",
                nameColor: m.nameColor || "",
                statusFontColor: m.statusFontColor || "",
                level: Number(p?.level) || Number(m.level) || 1,
                exp: Number(p?.exp) || Number(m.exp) || 0,
                roomRole: m.roomRole || (m.role === "admin" || m.role === "owner" ? "super_admin" : (m.role === "moderator" ? "moderator" : "member")),
                idreg: mIdreg,
              };
            });

            callback?.({
              success: true,
              roomId,
              messages,
              members: mappedMembers,
              memberCount: members.length,
            });
            console.log(`[VITE_TRACE] callback sent: memberCount=${members.length}`);

            if (!isReconnect) {
              const currentUserRecord = connectedUsers.get(socket.id);
              const currentUserProfile = memberProfilesMap.get(String(userId));
              const currentIdreg = String(currentUserProfile?.idreg || currentUserRecord?.idreg || userData.idreg || "").replace(/^#+/, "");
              console.log(`[VITE_TRACE] emitting user_joined to room=${roomId} memberCount=${members.length}`);
              socket.to(`room:${roomId}`).emit("user_joined", {
                socketId: socket.id,
                user: {
                  id: userId,
                  username,
                  role,
                  avatar: userData.avatar,
                  countryCode: userData.countryCode,
                  avatarFrameUrl: userData.avatarFrameUrl,
                  giftIconUrl: userData.giftIconUrl,
                  status: userData.status || "online",
                  nameColor: currentUserRecord?.nameColor || "",
                  statusFontColor: currentUserRecord?.statusFontColor || "",
                  level: Number(currentUserProfile?.level) || 1,
                  exp: Number(currentUserProfile?.exp) || 0,
                  roomRole: role === "admin" || role === "owner" ? "super_admin" : (role === "moderator" ? "moderator" : "member"),
                  idreg: currentIdreg,
                },
                memberCount: members.length,
              });

              // Broadcast live counter update globally for the new room
              console.log(`[VITE_TRACE] emitting room_count_update for room=${roomId} memberCount=${members.length}`);
              io!.emit("room_count_update", { roomId, memberCount: members.length });

              // Broadcast entrance/transition message to new room
              if (prev && prev !== roomId) {
                io!.to(`room:${roomId}`).emit("system_message", {
                  text: `دخل الغرفة (انتقل من: ${prevRoomName})`,
                  roomId,
                  systemType: "join",
                  user: {
                    id: userData.id,
                    username: userData.username,
                    role: userData.role,
                    avatar: userData.avatar,
                    countryCode: userData.countryCode,
                    avatarFrameUrl: userData.avatarFrameUrl,
                    giftIconUrl: userData.giftIconUrl,
                  }
                });
              } else {
                io!.to(`room:${roomId}`).emit("system_message", {
                  text: `دخل الغرفة`,
                  roomId,
                  systemType: "join",
                  user: {
                    id: userData.id,
                    username: userData.username,
                    role: userData.role,
                    avatar: userData.avatar,
                    countryCode: userData.countryCode,
                    avatarFrameUrl: userData.avatarFrameUrl,
                    giftIconUrl: userData.giftIconUrl,
                  }
                });
              }
            }

            if (room) {
              socket.emit("system_message", { type: "welcome", text: `مرحباً بك في ${room.name}`, roomId });
            }
          } catch (error) {
            console.error("Error joining room:", error);
            callback?.({ success: false, message: "تعذر الانضمام للغرفة" });
          }
        });

        socket.on("leave_room", (data: any) => {
          const roomId = String(data?.roomId || "").trim();
          if (!roomId) return;

          if (pendingLeaves.has(socket.id)) {
            clearTimeout(pendingLeaves.get(socket.id)!.timeout);
            pendingLeaves.delete(socket.id);
          }

          const runLeave = () => {
            pendingLeaves.delete(socket.id);
            const currentUser = connectedUsers.get(socket.id);
            console.log(`[KICK_TRACE_LEAVE] runLeave triggered socketId=${socket.id} roomId=${roomId} currentRoom=${currentUser?.roomId} kicked=${!!(socket as any).kicked}`);
            if (!currentUser || currentUser.roomId !== roomId) {
              console.log(`[VITE_TRACE] runLeave: SKIPPED (user no longer in room ${roomId}, current room=${currentUser?.roomId}) socketId=${socket.id}`);
              return;
            }
            socket.leave(`room:${roomId}`);
            leaveUserFromRoom(socket.id);
            io!.to(`room:${roomId}`).emit("user_left", { socketId: socket.id, username, roomId, memberCount: getRoomCount(roomId) });
            
            // إذا كان العضو مطروداً لا نرسل رسالة "غادر الغرفة"
            const isKicked = !!(socket as any).kicked;
            if (isKicked) {
              (socket as any).kicked = false;
            } else {
              // Broadcast leave system message
              io!.to(`room:${roomId}`).emit("system_message", {
                text: `غادر الغرفة`,
                roomId,
                systemType: "leave",
                user: {
                  id: userData.id,
                  username: userData.username,
                  role: userData.role,
                  avatar: userData.avatar,
                  countryCode: userData.countryCode,
                  avatarFrameUrl: userData.avatarFrameUrl,
                  giftIconUrl: userData.giftIconUrl,
                }
              });
            }

            // Broadcast live counter update globally
            io!.emit("room_count_update", { roomId, memberCount: getRoomCount(roomId) });
          };

          const timeout = setTimeout(() => {
            runLeave();
          }, 250);

          pendingLeaves.set(socket.id, { roomId, timeout });
        });

        socket.on("room_message", async (data: any, callback?: any) => {
          const roomId = String(data?.roomId || "").trim();
          const text = String(data?.text || "").trim();
          if (!roomId) { callback?.({ success: false, message: "معرف الغرفة مطلوب" }); return; }
          if (!text && !data?.mediaUrl && !data?.sticker && !data?.animatedFaces?.length) { callback?.({ success: false, message: "نص الرسالة مطلوب" }); return; }
          if (text.length > 1000) { callback?.({ success: false, message: "الرسالة طويلة جداً" }); return; }

          try {
            // --- تطبيق الفلترة ---
            let finalChatText = text;
            if (!finalChatText && data?.sticker) {
              finalChatText = "";
            } else if (!finalChatText && data?.mediaType === "audio") {
              finalChatText = "🎤 رسالة صوتية";
            }
            if (filterService && finalChatText) {
              const expanded = shortcutService ? await shortcutService.applyShortcuts(finalChatText) : finalChatText;
              const filterRes = await filterService.processText({
                text: expanded,
                source: `غرفة: ${roomId}`,
                user: { username, topic: username, ip: socket.handshake.address || "127.0.0.1" }
              });
              finalChatText = filterRes.filteredText;
            }

            // ─── جلب بيانات الرسالة المردود عليها ──────────────────────────
            const replyToId = data?.replyToId || "";
            let replyToText = "";
            let replyToSenderName = "";
            if (replyToId) {
              const parentMsg = chatStore.getRoomMessage ? chatStore.getRoomMessage(roomId, replyToId) : undefined;
              if (parentMsg) {
                replyToText = parentMsg.text || "";
                replyToSenderName = parentMsg.user || "";
              } else {
                replyToText = data?.replyToText || "";
                replyToSenderName = data?.replyToSenderName || "";
              }
            }

            const currentSender = connectedUsers.get(socket.id);
            const msg = await chatStore.addMessage({
              roomId,
              clientId: data.clientId,
              user: currentSender?.displayName || currentSender?.username || username,
              userId: userId,
              role,
              text: finalChatText,
              avatar: connectedUsers.get(socket.id)?.avatar || userData.avatar,
              countryCode: connectedUsers.get(socket.id)?.countryCode || userData.countryCode,
              avatarFrameUrl: connectedUsers.get(socket.id)?.avatarFrameUrl || userData.avatarFrameUrl,
              giftIconUrl: connectedUsers.get(socket.id)?.giftIconUrl || userData.giftIconUrl,
              messageBubbleStyle: connectedUsers.get(socket.id)?.messageBubbleStyle || userData.messageBubbleStyle,
              replyToId: replyToId || undefined,
              replyToText: replyToText || undefined,
              replyToSenderName: replyToSenderName || undefined,
              mediaUrl: data?.mediaUrl || undefined,
              mediaUrls: data?.mediaUrls || undefined,
              mediaType: data?.mediaType || undefined,
              sticker: data?.sticker || undefined,
              animatedFaces: data?.animatedFaces && data.animatedFaces.length > 0 ? data.animatedFaces : undefined,
            });

            io!.to(`room:${roomId}`).emit("new_message", { roomId, message: msg });
            callback?.({ success: true, message: msg });
          } catch (error) {
            console.error("Error sending message:", error);
            callback?.({ success: false, message: "تعذر إرسال الرسالة" });
          }
        });

        // ─── تفاعل على رسالة في غرفة ──────────────────────────────────────
        socket.on("room:react", async (data: any, callback?: any) => {
          try {
            const roomId = String(data?.roomId || "").trim();
            const messageId = String(data?.messageId || "").trim();
            const reaction = data?.reaction;

            if (!roomId || !messageId || !reaction) {
              return callback?.({ success: false, error: "بيانات ناقصة" });
            }

            const validReactions = chatStore.ROOM_REACTIONS || ["like", "love", "haha", "wow", "sad", "angry"];
            if (!validReactions.includes(reaction)) {
              return callback?.({ success: false, error: "نوع تفاعل غير صالح" });
            }

            const msg = chatStore.getRoomMessage ? chatStore.getRoomMessage(roomId, messageId) : undefined;
            if (!msg) {
              return callback?.({ success: false, error: "الرسالة غير موجودة" });
            }

            if (!msg.reactions) msg.reactions = {};

            const reactorId = String(userId || username || socket.id);
            const existingReaction = msg.reactions[reactorId];

            if (existingReaction === reaction) {
              delete msg.reactions[reactorId];
            } else {
              msg.reactions[reactorId] = reaction;
            }

            if (chatStore.updateRoomMessageReactions) {
              chatStore.updateRoomMessageReactions(roomId, messageId, msg.reactions);
            }

            // بث التحديث لجميع أعضاء الغرفة
            io!.to(`room:${roomId}`).emit("room_reaction", {
              roomId,
              messageId,
              reactions: msg.reactions,
            });

            callback?.({ success: true, reactions: msg.reactions });
          } catch (err) {
            console.error("[room:react] Error:", err);
            callback?.({ success: false, error: "خطأ في الخادم" });
          }
        });

        socket.on("typing", (data: any) => {
          const roomId = String(data?.roomId || "").trim();
          if (!roomId) return;
          const key = `${socket.id}:${roomId}`;
          if (typingTimers.has(key)) return;
          typingTimers.set(key, setTimeout(() => typingTimers.delete(key), 900));
          socket.to(`room:${roomId}`).emit("user_typing", { socketId: socket.id, username, roomId });
        });

        socket.on("stop_typing", (data: any) => {
          const roomId = String(data?.roomId || "").trim();
          if (!roomId) return;
          socket.to(`room:${roomId}`).emit("user_stop_typing", { socketId: socket.id, username, roomId });
        });

        // ===== Moderation Events =====
        socket.on("moderation_action", async (data: any, callback?: any) => {
          if (!powersService) {
            callback?.({ success: false, message: "خدمة الصلاحيات غير متاحة" });
            return;
          }

          const action = data?.action; // "kick", "ban", "alert"
          const targetUserId = data?.targetUserId || data?.targetSocketId; // backward compatible
          
          let targetUser: OnlineUser | undefined;
          let targetSocketId: string | undefined;
          
          for (const [sid, u] of connectedUsers.entries()) {
            if (u.id === targetUserId || sid === targetUserId) {
              targetUser = u;
              targetSocketId = sid;
              break;
            }
          }
          
          if (!targetUser || !targetSocketId) {
            callback?.({ success: false, message: "المستخدم غير متصل" });
            return;
          }

          if (!powersService.canExecuteAction(role, targetUser.role, action)) {
            callback?.({ success: false, message: "لا تملك الصلاحية الكافية" });
            return;
          }

          const roomId = targetUser.roomId;
          
          if (action === "alert") {
            io!.to(targetSocketId).emit("system_alert", {
              title: "تنبيه إداري",
              message: data?.reason || "تم تنبيهك من قبل الإدارة",
              from: username
            });
          } else if (action === "kick" || action === "ban") {
             // حفظ الطرد في قاعدة البيانات
             try {
               const mod = await import("./server/db");
               const minutes = Number(data?.value) || 15;
               const bannedUntil = new Date(Date.now() + minutes * 60 * 1000);
               await mod.dbPool.query(
                 `INSERT INTO room_kicks (room_id, user_id, banned_until) VALUES ($1, $2, $3)`,
                 [roomId, targetUser.id, bannedUntil]
               );
             } catch (e) {
               console.error("Failed to save room kick:", e);
             }

             io!.to(targetSocketId).emit("system_alert", {
               title: action === "ban" ? "حظر" : "طرد",
               message: action === "ban" ? "لقد تم حظرك من الموقع" : "لقد تم طردك من الغرفة",
               from: username
             });
             
              // Disconnect user
              const targetSocket = io!.sockets.sockets.get(targetSocketId);
              if (targetSocket) {
                (targetSocket as any).kicked = true;
                targetSocket.disconnect(true);
              }
          }

          await powersService.logModerationEvent({
            actorId: userId,
            targetUserId: targetUser.id,
            roomId,
            eventType: action,
            reason: data?.reason
          });

          callback?.({ success: true, message: `تم تنفيذ الإجراء ${action} بنجاح` });
          
          if (roomId) {
            io!.to(`room:${roomId}`).emit("system_message", { 
              text: `تم ${action === 'kick' ? 'طرد' : action === 'ban' ? 'حظر' : 'تنبيه'} ${targetUser.username}${action === 'kick' || action === 'ban' ? ` من الغرفة` : ''}`,
              roomId,
              systemType: action === 'kick' || action === 'ban' ? 'leave' : undefined,
              createdAt: new Date().toISOString(),
              user: {
                id: targetUser.id,
                username: targetUser.username,
                role: targetUser.role,
                avatar: targetUser.avatar || '/pic.png',
              }
            });
          }
        });

        socket.on("get_rooms", async (callback?: any) => {
          try {
            const rooms = await chatStore.listRooms();
            const result = rooms.map((r: any) => ({ ...r, members: getRoomCount(r.id) }));
            callback?.({ success: true, rooms: result });
          } catch (error) {
             callback?.({ success: false, message: "تعذر جلب الغرف" });
          }
        });

        // ===== Presence Events =====
        const getPresenceKey = (user: Pick<OnlineUser, "id" | "socketId" | "username" | "role">) => {
          const id = String(user.id || "").trim();
          if (id && id !== "0") return `id:${id}`;
          if (user.socketId) return `socket:${user.socketId}`;
          const name = String(user.username || "").trim().toLowerCase();
          if (name && user.role !== "guest") return `username:${name}`;
          return `guest:${name || "anonymous"}`;
        };

        socket.on("get_online_users", (callback?: any) => {
          console.log(`[VITE_TRACE_PRESENCE] get_online_users requested by ${socket.id} connectedUsers count=${connectedUsers.size} users=${JSON.stringify(Array.from(connectedUsers.values()).map(u=>({id:u.id, username:u.username, socketId:u.socketId, roomId:u.roomId})))}`);
          const uniqueUsers = new Map<string, any>();
          
          for (const u of connectedUsers.values()) {
            const uniqueKey = getPresenceKey(u);
            const existing = uniqueUsers.get(uniqueKey);
            
             if (!existing) {
              uniqueUsers.set(uniqueKey, {
                id: u.id, socketId: u.socketId, username: u.username,
                displayName: u.displayName || u.username,
                mentionName: u.mentionName || "",
                publicUserId: u.publicUserId || "",
                role: u.role, avatar: u.avatar,
                countryCode: u.countryCode, avatarFrameUrl: u.avatarFrameUrl,
                giftIconUrl: u.giftIconUrl, memberCardBgUrl: u.memberCardBgUrl,
                nameColor: u.nameColor, messageColor: u.messageColor,
                roomId: u.roomId,
                status: u.status || "online",
                idreg: u.idreg, siteBadge: u.siteBadge,
                statusMsg: u.statusMsg || "",
                giftedBannerUrl: u.giftedBannerUrl || "",
                giftedGiftIconUrl: u.giftedGiftIconUrl || "",
                giftedPromotionIconUrl: u.giftedPromotionIconUrl || "",
                roleIconUrl: u.roleIconUrl || "",
              });
            } else {
              const priorities: Record<string, number> = { "busy": 4, "away": 3, "idle": 2, "online": 1 };
              const currentPrio = priorities[existing.status] || 0;
              const newPrio = priorities[u.status || "online"] || 0;
              if (newPrio > currentPrio) {
                existing.status = u.status || "online";
              }
            }
          }
          
          const users = Array.from(uniqueUsers.values()).map(normalizeOnlineUserAssets);
          callback?.({ success: true, users, count: uniqueUsers.size });
        });

        // ===== get_room_members — يُستخدم للتحقق بعد إعادة الاتصال =====
        socket.on("get_room_members", (data: any, callback?: any) => {
          if (typeof callback !== "function") return;
          const roomId = typeof data?.roomId === "string" ? data.roomId.trim() : "";
          if (!roomId) return callback({ success: false, message: "roomId مطلوب" });

          const members: any[] = [];
          for (const u of connectedUsers.values()) {
            if (String(u.roomId || "") !== roomId) continue;
            members.push({
              id: u.id,
              socketId: u.socketId,
              username: u.username,
              displayName: u.displayName || u.username,
              role: u.role,
              avatar: u.avatar,
              countryCode: u.countryCode,
              avatarFrameUrl: u.avatarFrameUrl || "",
              status: u.status || "online",
            });
          }
          callback({ success: true, members, memberCount: members.length });
        });

        // ===== ping_keepalive — يتجاهله السيرفر لكن يجدّد نشاط الاتصال =====
        socket.on("ping_keepalive", () => {
          // لا يُرسل رداً — الغرض الوحيد هو إعلام السيرفر أن العميل لا يزال حياً
          // وهذا يمنع Socket.io من احتساب انتهاء pingTimeout
        });

        // ===== Status Update Events =====
        socket.on("status_update", (data: any) => {
          const newStatus = String(data?.status || "online").trim();
          const validStatuses = ["online", "idle", "busy", "away"];
          if (!validStatuses.includes(newStatus)) return;

          const user = connectedUsers.get(socket.id);
          if (!user) return;
          user.status = newStatus as OnlineUser["status"];

          // Broadcast the status change to ALL connected clients
          io!.emit("user_status_update", {
            socketId: socket.id,
            userId: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            mentionName: user.mentionName || "",
            publicUserId: user.publicUserId || "",
            role: user.role,
            status: newStatus,
            idreg: user.idreg,
            avatar: user.avatar,
            countryCode: user.countryCode,
            roomId: user.roomId,
            siteBadge: user.siteBadge,
            statusMsg: user.statusMsg || "",
          });
        });

        // ===== Profile Update Events =====
        socket.on("profile_update", (data: any) => {
          const user = connectedUsers.get(socket.id);
          if (!user) return;

          const oldUsername = user.username;

          if (data.avatar) {
            user.avatar = data.avatar;
            userData.avatar = data.avatar;
            socket.data.user.avatar = data.avatar;
          }
          if (data.avatarFrameUrl) user.avatarFrameUrl = data.avatarFrameUrl;
          if (data.giftIconUrl) user.giftIconUrl = data.giftIconUrl;
          if (data.memberCardBgUrl !== undefined) user.memberCardBgUrl = data.memberCardBgUrl;
          if (data.nameColor !== undefined) user.nameColor = data.nameColor;
          if (data.messageColor !== undefined) user.messageColor = data.messageColor;
          if (data.messageBubbleStyle) user.messageBubbleStyle = data.messageBubbleStyle;
          if (typeof data.displayName === "string" && data.displayName.trim().length > 0) {
            const sanitizedDisplayName = data.displayName.trim().slice(0, 80);
            user.displayName = sanitizedDisplayName;
            userData.displayName = sanitizedDisplayName;
            socket.data.user.displayName = sanitizedDisplayName;
          }
          if (typeof data.mentionName === "string") {
            const sanitizedMentionName = data.mentionName.trim().slice(0, 32);
            user.mentionName = sanitizedMentionName;
            userData.mentionName = sanitizedMentionName;
            socket.data.user.mentionName = sanitizedMentionName;
          }

          addConnectedUser(socket.id, user).catch(() => {});

          chatStore.updateUserMessageIdentity(oldUsername, {
            avatar: user.avatar,
            avatarFrameUrl: user.avatarFrameUrl,
            giftIconUrl: user.giftIconUrl,
            messageBubbleStyle: user.messageBubbleStyle,
          });

          // Broadcast the profile update to ALL connected clients
          io!.emit("user_profile_updated", {
            socketId: socket.id,
            userId: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            mentionName: user.mentionName || "",
            publicUserId: user.publicUserId || "",
            previousUsername: oldUsername,
            avatar: data.avatar || user.avatar,
            avatarUrl: data.avatarUrl || data.avatar || user.avatar,
            profileCover: data.profileCover || data.cover,
            cover: data.profileCover || data.cover,
            avatarFrameUrl: user.avatarFrameUrl,
            giftIconUrl: user.giftIconUrl,
            memberCardBgUrl: user.memberCardBgUrl,
            nameColor: user.nameColor,
            messageColor: user.messageColor,
            messageBubbleStyle: user.messageBubbleStyle,
            profileMsg: data.profileMsg,
            statusMsg: data.profileMsg || "",
          });
        });

        socket.on("wall_post_created", (post: any) => {
          io!.emit("wall_post_created", post);
        });

        // ===== PM Events =====
        socket.on("pm_message", async (data: any, callback?: any) => {
          const toSocketId = String(data?.toSocketId || "").trim();
          const text = String(data?.text || "").trim();
          if (!toSocketId || !text) { callback?.({ success: false, message: "بيانات ناقصة" }); return; }
          
          // --- تطبيق الفلترة في الخاص ---
          let finalPmText = text;
          if (filterService) {
            const expanded = shortcutService ? await shortcutService.applyShortcuts(text) : text;
            const filterRes = await filterService.processText({
              text: expanded,
              source: `محادثة خاصة مع ${toSocketId}`,
              user: { username, topic: username, ip: socket.handshake.address || "127.0.0.1" },
              target: toSocketId
            });
            finalPmText = filterRes.filteredText;
          }

          const msg = { 
            id: crypto.randomUUID(), 
            clientId: data.clientId, 
            fromSocketId: socket.id, 
            toSocketId, 
            user: username, 
            role, 
            avatar: connectedUsers.get(socket.id)?.avatar || userData.avatar, 
            countryCode: connectedUsers.get(socket.id)?.countryCode || userData.countryCode, 
            text: finalPmText.slice(0, 1000), 
            createdAt: new Date().toISOString() 
          };
          
          io!.to(toSocketId).emit("pm_message", msg);
          callback?.({ success: true, message: msg });
        });

        socket.on("pm_typing", (data: any) => {
          const to = String(data?.toSocketId || "").trim();
          if (to) io!.to(to).emit("pm_typing", { fromSocketId: socket.id, username });
        });

        // ===== Profile Handlers =====
        try {
          registerProfileHandlers(io!, socket);
        } catch (err) {
          console.error("[vite-socket] Error registering profile handlers:", err);
        }

        // ===== Story Handlers =====
        try {
          registerStoryHandlers(io!, socket);
        } catch (err) {
          console.error("[vite-socket] Error registering story handlers:", err);
        }

        // ===== Wall Handlers (posts, likes, comments) =====
        try {
          registerWallHandlers(io!, socket);
        } catch (err) {
          console.error("[vite-socket] Error registering wall handlers:", err);
        }

        // ===== Notification Handlers =====
        try {
          registerNotificationHandlers(io!, socket);
        } catch (err) {
          console.error("[vite-socket] Error registering notification handlers:", err);
        }

        // ===== Mail Handlers =====
        try {
          registerMailHandlers(io!, socket);
        } catch (err) {
          console.error("[vite-socket] Error registering mail handlers:", err);
        }

        // ===== Private Message Handlers =====
        try {
          registerPrivateHandlers(io!, socket);
        } catch (pmErr) {
          console.error("[vite-socket] Error registering private handlers:", pmErr);
        }

        // ===== Voice Stage Handlers =====
        try {
          registerVoiceStageHandlers(io!, socket);
        } catch (err) {
          console.error("[vite-socket] Error registering voice stage handlers:", err);
        }

        // ===== Call Handlers (WebRTC 1-on-1 Private Voice Call) =====
        try {
          registerCallHandlers(io!, socket);
        } catch (callErr) {
          console.error("[vite-socket] Error registering call handlers:", callErr);
        }

        // ===== Room Profile & Role Handlers =====
        socket.on("room:get_profile", (data: any, cb?: any) => {
          if (roomHandlers?.handleGetRoomProfile) {
            roomHandlers.handleGetRoomProfile(io!, socket, data, cb);
          } else {
            import("./server/socket/roomHandlers").then(m => {
              m.handleGetRoomProfile(io!, socket, data, cb);
            }).catch(err => {
              console.error("[vite-socket] Failed to handle room:get_profile:", err);
              cb?.({ success: false, message: "فشل معالجة طلب البروفايل" });
            });
          }
        });

        socket.on("room:set_role", (data: any, cb?: any) => {
          if (roomHandlers?.handleSetRoomRole) {
            roomHandlers.handleSetRoomRole(io!, socket, data, cb);
          } else {
            import("./server/socket/roomHandlers").then(m => {
              m.handleSetRoomRole(io!, socket, data, cb);
            }).catch(err => {
              console.error("[vite-socket] Failed to handle room:set_role:", err);
              cb?.({ success: false, message: "فشل تعيين الرتبة" });
            });
          }
        });

        // ===== User Logout =====
        socket.on("user_logout", () => {
          try {
            console.log(`[SOCKET_TRACE] user_logout received socket=${socket.id} userId=${socket.data?.user?.id || ""} referer=${socket.handshake.headers.referer || ""}`);
            (socket as any).loggedOut = true;
            const anotherSessionIsOnline = Array.from(connectedUsers.entries()).some(
              ([sid, user]) =>
                sid !== socket.id &&
                String(user.id) === String(userData.id) &&
                String(user.sessionId || "") !== String(userData.sessionId || ""),
            );
            const removed = removeUser(socket.id);
            removeConnectedUser(socket.id).catch(() => {});
            if (removed) {
              if (!anotherSessionIsOnline) broadcastUserDisconnected(removed);
              io!.emit("online_count", { count: computeUniqueOnlineCount() });
            }
            socket.disconnect(true);
          } catch (e) {
            console.error("[vite-socket] user_logout error:", e);
          }
        });

        // ===== Disconnect =====
        socket.on("disconnect", (disconnectReason: any) => {
          console.log(`[SOCKET_TRACE] disconnect reason=${disconnectReason || "unknown"} socket=${socket.id} loggedOut=${!!(socket as any).loggedOut} user=${socket.data?.user?.username || ""}`);
          if ((socket as any).loggedOut) {
            return;
          }
          if (pendingLeaves.has(socket.id)) {
            clearTimeout(pendingLeaves.get(socket.id)!.timeout);
            pendingLeaves.delete(socket.id);
          }
          const user = connectedUsers.get(socket.id);
          if (user?.roomId) {
            // مفتاح مؤقت قطع الاتصال لكل "جلسة" (socketId) وليس للمستخدم:
            // لو استخدمنا userId فإن انقطاع جلستين لنفس المستخدم يؤدي إلى إلغاء
            // مؤقّت الجلسة الأولى دون حذف سجلها فيبقى سجلاً يتيم في connectedUsers
            // ويرفع عدّاد "متصل الآن" للأبد (عدّاد أكبر من عدد الأشخاص الفعليين).
            const socketKey = socket.id;
            // إلغاء معلّق سابق لنفس الجلسة فقط إن وُجد
            const ownPending = pendingDisconnects.get(socketKey);
            if (ownPending) {
              clearTimeout(ownPending.timeout);
              pendingDisconnects.delete(socketKey);
            }

            const runDisconnect = () => {
              pendingDisconnects.delete(socketKey);
              const latestUser = connectedUsers.get(socket.id);
              if (!latestUser) return;
              const isStillConnected = Array.from(connectedUsers.values()).some(
                u => String(u.id) === String(user.id) && u.socketId !== socket.id
              );
              if (isStillConnected) {
                console.log(`[VITE_TRACE] runDisconnect: user ${username} has another active socket, skipping user_left`);
                removeUser(socket.id);
                return;
              }
              const roomId = latestUser.roomId;
              console.log(`[KICK_TRACE_DISCONNECT] runDisconnect triggered (old server) socketId=${socket.id} roomId=${roomId} kicked=${!!(socket as any).kicked}`);

              io!.to(`room:${roomId}`).emit("user_left", { socketId: socket.id, username, roomId, memberCount: Math.max(0, getRoomCount(roomId) - 1) });
              
              // إذا كان العضو مطروداً لا نرسال رسالة "غادر الغرفة"
              const isKicked = !!(socket as any).kicked;
              if (isKicked) {
                (socket as any).kicked = false;
              } else {
                // Broadcast leave system message (disconnect)
                io!.to(`room:${roomId}`).emit("system_message", {
                  text: `غادر الغرفة (انقطع الاتصال)`,
                  roomId,
                  systemType: "leave",
                  user: {
                    id: latestUser.id,
                    username: latestUser.username,
                    role: latestUser.role,
                    avatar: latestUser.avatar,
                    countryCode: latestUser.countryCode,
                    avatarFrameUrl: latestUser.avatarFrameUrl,
                    giftIconUrl: latestUser.giftIconUrl,
                  }
                });
              }

              // Broadcast live counter update globally
              io!.emit("room_count_update", { roomId, memberCount: Math.max(0, getRoomCount(roomId) - 1) });

              for (const [key, timer] of typingTimers) {
                if (key.startsWith(`${socket.id}:`)) { clearTimeout(timer); typingTimers.delete(key); }
              }
              removeUser(socket.id);
              broadcastUserDisconnected(latestUser);
              io!.emit("online_count", { count: computeUniqueOnlineCount() });
            };

            const timeout = setTimeout(() => {
              runDisconnect();
            }, 15000); // 15 ثانية سماحية — تمنع ظهور "غادر/دخل" عند إعادة الاتصال السريعة

            pendingDisconnects.set(socketKey, {
              roomId: user.roomId,
              timeout,
              socketId: socket.id,
              userId: user.id,
            });
          } else {
            const user = removeUser(socket.id);
            if (user) {
              broadcastUserDisconnected(user);
              io!.emit("online_count", { count: computeUniqueOnlineCount() });
            }
          }
        });
      });

      console.log("[Socket.io] ✅ WebSocket server attached on path /ws");
    },
  };
}
