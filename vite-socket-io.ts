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
import { normalizeMinioUrl, normalizeOptionalMinioUrl } from "./server/services/minioClient";

export function viteSocketIO(): Plugin {
  let io: SocketIOServer | null = null;

  return {
    name: "vite-plugin-socket-io",
    configureServer(server) {
      if (!server.httpServer) return;

      (globalThis as any).__VITE_SOCKET_IO_CREATED__ = true;
      (process as any).__VITE_SOCKET_IO_CREATED__ = true;

      io = new SocketIOServer(server.httpServer, {
        path: "/ws",
        serveClient: false,
        transports: ["websocket", "polling"],
        allowUpgrades: true,
        pingInterval: 20000,
        pingTimeout: 180000,
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

      // Initialize the SocketBroker with this io instance
      initializeSocketBroker(io);
      (globalThis as any).__socket_io_instance__ = io;
      (process as any).__socket_io_instance__ = io;

      // Expose room member counts as JSON endpoint for Nitro to consume
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/__terminate_user_sessions__' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => { body += chunk; });
          req.on('end', () => {
            try {
              const { userId } = JSON.parse(body || '{}');
              if (userId) {
                const targetId = String(userId).trim();
                for (const [sid, u] of Array.from(connectedUsers.entries())) {
                  if (String(u.id) === targetId || String(u.username).toLowerCase() === targetId.toLowerCase()) {
                    removeUser(sid);
                    removeConnectedUser(sid).catch(() => {});
                    io?.to(sid).emit("force_logout", { message: "تم إنهاء الجلسة لتسجيل الخروج" });
                    io?.sockets.sockets.get(sid)?.disconnect(true);
                  }
                }
                const count = connectedUsers.size;
                io?.emit("online_count", { count });
                io?.emit("user_disconnected", { userId: targetId, count });
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } catch {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false }));
            }
          });
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

      // Profile handlers
      let profileHandlers: any;
      import("./server/socket/profileHandlers").then(m => { profileHandlers = m; });
      // Story handlers
      let storyHandlers: any;
      import("./server/socket/storyHandlers").then(m => { storyHandlers = m; });
      // Wall handlers (create, like, comment)
      let wallHandlers: any;
      import("./server/socket/wallHandlers").then(m => { wallHandlers = m; });
      // Notification handlers
      let notificationHandlers: any;
      import("./server/socket/notificationHandlers").then(m => { notificationHandlers = m; });
      // Mail handlers
      let mailHandlers: any;
      import("./server/socket/mailHandlers").then(m => { mailHandlers = m; });
      // Private message handlers
      let privateHandlers: any;
      import("./server/socket/privateHandlers").then(m => { privateHandlers = m; }).catch(e => console.error("[vite-socket] Failed to load privateHandlers:", e));
      // Voice Stage handlers
      let voiceStageHandlers: any;
      import("./server/socket/voiceStageHandlers").then(m => { voiceStageHandlers = m; }).catch(e => console.error("[vite-socket] Failed to load voiceStageHandlers:", e));
      // Room Handlers (profile, roles)
      let roomHandlers: any;
      import("./server/socket/roomHandlers").then(m => { roomHandlers = m; }).catch(e => console.error("[vite-socket] Failed to load roomHandlers:", e));

      // ========== Presence Manager (inline) ==========
      type OnlineUser = {
        id: string;
        socketId: string;
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
      const pendingDisconnects = new Map<string, { roomId: string; timeout: NodeJS.Timeout; socketId: string }>();
      console.log("[VITE_TRACE_PRESENCE] Exposed connectedUsers and roomMembersMap on globalThis");

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
          count: connectedUsers.size,
        });
      }

      function broadcastUserDisconnected(user: OnlineUser) {
        io!.emit("user_disconnected", {
          socketId: user.socketId,
          userId: user.id,
          username: user.username,
          role: user.role,
          count: connectedUsers.size,
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

        // رفض الاتصال غير الموثق لضمان عدم ظهور الزوار على شاشة الدخول كمتصلين
        if (!auth.userId || typeof auth.userId !== "string" || !auth.userId.trim()) {
          console.debug("[vite-socket] rejecting unauthenticated socket connection:", socket.id);
          socket.disconnect(true);
          return;
        }

        let username = auth.username || "زائر";
        const role = auth.role || "guest";
        const userId = auth.userId.trim();

        const handshakeProfileMsg = typeof auth.statusMsg === "string" && auth.statusMsg.trim()
          ? auth.statusMsg.trim()
          : (typeof auth.profileMsg === "string" && auth.profileMsg.trim()
            ? auth.profileMsg.trim()
            : "");
        const userData: Omit<OnlineUser, "socketId"> = {
          id: userId,
          username,
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
          statusMsg: handshakeProfileMsg,
          giftedBannerUrl: auth.giftedBannerUrl || "",
          giftedGiftIconUrl: auth.giftedGiftIconUrl || "",
          giftedPromotionIconUrl: auth.giftedPromotionIconUrl || "",
          roleIconUrl: auth.roleIconUrl || "",
        };

        socket.data.user = userData;
        console.log(`[VITE_TRACE_PRESENCE] new connection socketId=${socket.id} username=${username} userId=${userId}`);
        console.log(`[VITE_TRACE_PRESENCE] existing connectedUsers count=${connectedUsers.size} entries=${JSON.stringify(Array.from(connectedUsers.values()).map(u=>({id:u.id, username:u.username, socketId:u.socketId, roomId:u.roomId})))}`);
        console.log(`[VITE_TRACE_PRESENCE] existing roomMembersMap keys=${JSON.stringify(Array.from(roomMembersMap.keys()))} details=${JSON.stringify(Object.fromEntries(Array.from(roomMembersMap.entries()).map(([k,v])=>[k,Array.from(v)])))}`);
        addUser(socket.id, userData);
        addConnectedUser(socket.id, userData).catch(err => console.error("[vite-socket] addConnectedUser failed:", err));

        // Enrich from DB at connection time
        (async () => {
          try {
            const mod = await import("./server/db");
            const result = await mod.dbPool.query(
              `SELECT "member_card_bg_url", "name_color", "message_color", "idreg", "avatar_frame_url", "profile_msg",
                      "gifted_banner_url", "gifted_gift_icon_url", "gifted_promotion_icon_url"
               FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
              [userId]
            );
            const row = result.rows[0];
            if (row) {
              const u = connectedUsers.get(socket.id);
              if (u) {
                if (row.member_card_bg_url) u.memberCardBgUrl = String(row.member_card_bg_url).trim();
                if (row.name_color) u.nameColor = String(row.name_color).trim();
                if (row.message_color) u.messageColor = String(row.message_color).trim();
                if (row.idreg) u.idreg = String(row.idreg).trim();
                if (row.avatar_frame_url) u.avatarFrameUrl = String(row.avatar_frame_url).trim();
                if (row.gifted_banner_url) u.giftedBannerUrl = String(row.gifted_banner_url).trim();
                if (row.gifted_gift_icon_url) u.giftedGiftIconUrl = String(row.gifted_gift_icon_url).trim();
                if (row.gifted_promotion_icon_url) u.giftedPromotionIconUrl = String(row.gifted_promotion_icon_url).trim();
                if (row.profile_msg) {
                  const msg = String(row.profile_msg).trim();
                  u.statusMsg = msg;
                }
              }
            }
            // Fetch missing idreg from users table if not present in profile
            const currentU = connectedUsers.get(socket.id);
            if (currentU && !currentU.idreg && userId) {
              const userRes = await mod.dbPool.query(
                `SELECT idreg FROM users WHERE id::text = $1 OR uid::text = $1 OR lower(username) = lower($2) LIMIT 1`,
                [userId, username]
              );
              if (userRes.rows[0]?.idreg) {
                currentU.idreg = String(userRes.rows[0].idreg).trim();
                socket.data.user.idreg = currentU.idreg;
              }
            }
            // Fetch role icon
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
              const u = connectedUsers.get(socket.id);
              if (u) {
                u.roleIconUrl = normalizeOptionalMinioUrl(roleResult.rows[0].role_icon_url);
              }
            }
            // Fallback to legacy ucol/mcol
            if (!connectedUsers.get(socket.id)?.nameColor || !connectedUsers.get(socket.id)?.messageColor) {
              const legResult = await mod.dbPool.query(`SELECT "ucol", "mcol" FROM "users" WHERE "id" = $1 LIMIT 1`, [userId]);
              if (legResult.rows[0]) {
                const u = connectedUsers.get(socket.id);
                if (u) {
                  if (!u.nameColor) u.nameColor = (legResult.rows[0].ucol || "").toString().trim();
                  if (!u.messageColor) u.messageColor = (legResult.rows[0].mcol || "").toString().trim();
                }
              }
            }
          } catch (_) {}
        })();

        // الانضمام للقنوات الشخصية (إشعارات، حضور، etc.)
        joinUserChannels(socket);

        const connectedUser = connectedUsers.get(socket.id)!;
        broadcastUserConnected(connectedUser);
        io!.emit("online_count", { count: connectedUsers.size });

        // Join moderators alerts room if authorized
        if (role === 'admin' || role === 'owner') {
          socket.join("moderators_alerts");
        }

        socket.emit("connected", {
          socketId: socket.id,
          user: userData,
          serverTime: new Date().toISOString(),
        });

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

          const userKey = userId;
          const pendingDisconnect = pendingDisconnects.get(userKey);
          let isReconnect = false;

          if (pendingDisconnect) {
            clearTimeout(pendingDisconnect.timeout);
            pendingDisconnects.delete(userKey);

            const oldSocketId = pendingDisconnect.socketId;
            const isSameSocket = oldSocketId === socket.id;
            if (!isSameSocket) {
              removeUser(oldSocketId);
              console.log(`[VITE_TRACE] pendingDisconnect: removed OLD socket oldSocketId=${oldSocketId} (different from current)`);
            } else {
              console.log(`[VITE_TRACE] pendingDisconnect: SKIPPED removeUser (same socket) oldSocketId=${oldSocketId}`);
            }

            if (pendingDisconnect.roomId === roomId) {
              isReconnect = true;
              console.log(`[VITE_TRACE] isReconnect=true (same room) roomId=${roomId}`);
            } else {
              prev = pendingDisconnect.roomId;
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

            const msg = await chatStore.addMessage({
              roomId,
              clientId: data.clientId,
              user: username,
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
                id: u.id, socketId: u.socketId, username: u.username, role: u.role, avatar: u.avatar,
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
            user.username = data.displayName.trim().slice(0, 80);
            userData.username = user.username;
            socket.data.user.username = user.username;
            username = user.username;
          }

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
        if (profileHandlers) {
          profileHandlers.registerProfileHandlers(io!, socket);
        }

        // ===== Story Handlers =====
        if (storyHandlers) {
          storyHandlers.registerStoryHandlers(io!, socket);
        }

        // ===== Wall Handlers (posts, likes, comments) =====
        if (wallHandlers) {
          wallHandlers.registerWallHandlers(io!, socket);
        }

        // ===== Notification Handlers =====
        if (notificationHandlers) {
          notificationHandlers.registerNotificationHandlers(io!, socket);
        }

        // ===== Mail Handlers =====
        if (mailHandlers) {
          mailHandlers.registerMailHandlers(io!, socket);
        }

        // ===== Private Message Handlers =====
        if (privateHandlers) {
          privateHandlers.registerPrivateHandlers(io!, socket);
        }

        // ===== Voice Stage Handlers =====
        if (voiceStageHandlers) {
          voiceStageHandlers.registerVoiceStageHandlers(io!, socket);
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
            (socket as any).loggedOut = true;
            const removed = removeUser(socket.id);
            removeConnectedUser(socket.id).catch(() => {});
            if (removed) {
              broadcastUserDisconnected(removed);
              io!.emit("online_count", { count: connectedUsers.size });
            }
            if (userData.id) {
              for (const [sid, u] of connectedUsers.entries()) {
                if (sid !== socket.id && String(u.id) === String(userData.id)) {
                  removeUser(sid);
                  removeConnectedUser(sid).catch(() => {});
                  io!.to(sid).emit("force_logout", { message: "تم إنهاء الجلسة لتسجيل الخروج" });
                  io!.sockets.sockets.get(sid)?.disconnect(true);
                }
              }
            }
            socket.disconnect(true);
          } catch (e) {
            console.error("[vite-socket] user_logout error:", e);
          }
        });

        // ===== Disconnect =====
        socket.on("disconnect", () => {
          if ((socket as any).loggedOut) {
            return;
          }
          if (pendingLeaves.has(socket.id)) {
            clearTimeout(pendingLeaves.get(socket.id)!.timeout);
            pendingLeaves.delete(socket.id);
          }
          const user = connectedUsers.get(socket.id);
          if (user?.roomId) {
            const userKey = user.id;
            if (pendingDisconnects.has(userKey)) {
              clearTimeout(pendingDisconnects.get(userKey)!.timeout);
            }

            const runDisconnect = () => {
              pendingDisconnects.delete(userKey);
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
              io!.emit("online_count", { count: connectedUsers.size });
            };

            const timeout = setTimeout(() => {
              runDisconnect();
            }, 3000);

            pendingDisconnects.set(userKey, {
              roomId: user.roomId,
              timeout,
              socketId: socket.id,
            });
          } else {
            const user = removeUser(socket.id);
            if (user) {
              broadcastUserDisconnected(user);
              io!.emit("online_count", { count: connectedUsers.size });
            }
          }
        });
      });

      console.log("[Socket.io] ✅ WebSocket server attached on path /ws");
    },
  };
}
