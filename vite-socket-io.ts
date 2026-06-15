/**
 * Vite Plugin: Socket.io Integration
 * يربط Socket.io مع سيرفر Vite Dev عبر HTTP Server hook
 */
import type { Plugin } from "vite";
import { Server as SocketIOServer } from "socket.io";
import { initializeSocketBroker } from "./server/socket/SocketBroker";
import { joinUserChannels } from "./server/socket/SocketChannels";

export function viteSocketIO(): Plugin {
  let io: SocketIOServer | null = null;

  return {
    name: "vite-plugin-socket-io",
    configureServer(server) {
      if (!server.httpServer) return;

      (globalThis as any).__VITE_SOCKET_IO_CREATED__ = true;

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
        messageBubbleStyle: string;
        roomId: string;
        connectedAt: string;
        status: "online" | "idle" | "busy" | "away";
        idreg?: string;
        siteBadge?: string;
      };

      const connectedUsers = new Map<string, OnlineUser>();
      const roomMembersMap = new Map<string, Set<string>>();
      const pendingLeaves = new Map<string, { roomId: string; timeout: NodeJS.Timeout }>();
      const pendingDisconnects = new Map<string, { roomId: string; timeout: NodeJS.Timeout; socketId: string }>();

      function addUser(socketId: string, data: Omit<OnlineUser, "socketId">) {
        connectedUsers.set(socketId, { ...data, socketId });
      }

      function broadcastUserConnected(user: OnlineUser) {
        io!.emit("user_connected", {
          socketId: user.socketId,
          userId: user.id,
          username: user.username,
          role: user.role,
          avatar: user.avatar,
          countryCode: user.countryCode,
          avatarFrameUrl: user.avatarFrameUrl,
          giftIconUrl: user.giftIconUrl,
          roomId: user.roomId,
          status: user.status,
          idreg: user.idreg,
          siteBadge: user.siteBadge,
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
          connectedUsers.delete(socketId);
          if (user.roomId) {
            const members = roomMembersMap.get(user.roomId);
            if (members) {
              members.delete(socketId);
              if (members.size === 0) roomMembersMap.delete(user.roomId);
            }
          }
        }
        return user;
      }

      function joinUserToRoom(socketId: string, roomId: string) {
        const user = connectedUsers.get(socketId);
        if (!user) return;
        if (user.roomId && user.roomId !== roomId) {
          leaveUserFromRoom(socketId);
        }
        user.roomId = roomId;
        if (!roomMembersMap.has(roomId)) roomMembersMap.set(roomId, new Set());
        roomMembersMap.get(roomId)!.add(socketId);
      }

      function leaveUserFromRoom(socketId: string) {
        const user = connectedUsers.get(socketId);
        if (!user || !user.roomId) return undefined;
        const roomId = user.roomId;
        const members = roomMembersMap.get(roomId);
        if (members) {
          members.delete(socketId);
          if (members.size === 0) roomMembersMap.delete(roomId);
        }
        user.roomId = "";
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
      let requestCountry: any;
      import("./server/services/requestCountry").then(m => { requestCountry = m; });

      // ========== Typing throttle ==========
      const typingTimers = new Map<string, NodeJS.Timeout>();

      // ========== Socket.io Connection Handler ==========
      io.on("connection", (socket) => {
        const auth = socket.handshake.auth || {};
        let username = auth.username || "زائر";
        const role = auth.role || "guest";
        const userId = auth.userId || socket.id;

        const userData: Omit<OnlineUser, "socketId"> = {
          id: userId,
          username,
          role,
          avatar: auth.avatar || "/pic.png",
          countryCode: auth.countryCode || "SA",
          avatarFrameUrl: auth.avatarFrameUrl || "",
          giftIconUrl: auth.giftIconUrl || "",
          messageBubbleStyle: auth.messageBubbleStyle || "default",
          roomId: "",
          connectedAt: new Date().toISOString(),
          status: "online",
          idreg: auth.idreg || "",
          siteBadge: auth.siteBadge || "",
        };

        addUser(socket.id, userData);
        socket.data.user = { id: userId, username, role, avatar: userData.avatar };

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

          const pendingLeave = pendingLeaves.get(socket.id);
          let prev = connectedUsers.get(socket.id)?.roomId;
          if (pendingLeave) {
            clearTimeout(pendingLeave.timeout);
            prev = pendingLeave.roomId;
            pendingLeaves.delete(socket.id);
          }

          const userKey = userData.username;
          const pendingDisconnect = pendingDisconnects.get(userKey);
          let isReconnect = false;

          if (pendingDisconnect) {
            // إلغاء مؤقت الخروج بالكامل!
            clearTimeout(pendingDisconnect.timeout);
            pendingDisconnects.delete(userKey);

            // إزالة السوكت القديم من الحضور فوراً لمنع الازدواجية
            const oldSocketId = pendingDisconnect.socketId;
            removeUser(oldSocketId);

            if (pendingDisconnect.roomId === roomId || data?.isReconnect) {
              isReconnect = true;
            } else {
              prev = pendingDisconnect.roomId;
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
            socket.leave(`room:${prev}`);
            leaveUserFromRoom(socket.id);
            io!.to(`room:${prev}`).emit("user_left", { socketId: socket.id, username, roomId: prev, memberCount: getRoomCount(prev) });
            
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
            io!.emit("room_count_update", { roomId: prev, memberCount: getRoomCount(prev) });
          }

          socket.join(`room:${roomId}`);
          joinUserToRoom(socket.id, roomId);

          const members = getRoomUsers(roomId);
          
          try {
            const messages = await chatStore.listMessages(roomId);
            const rooms = await chatStore.listRooms();
            const room = rooms.find((r: any) => r.id === roomId);

            callback?.({
              success: true,
              roomId,
              messages,
              members: members.map(m => ({ id: m.id, username: m.username, role: m.role, avatar: m.avatar, countryCode: m.countryCode, avatarFrameUrl: m.avatarFrameUrl, giftIconUrl: m.giftIconUrl, status: m.status || "online" })),
              memberCount: members.length,
            });

            if (!isReconnect) {
              socket.to(`room:${roomId}`).emit("user_joined", {
                socketId: socket.id,
                user: { id: userId, username, role, avatar: userData.avatar, countryCode: userData.countryCode, avatarFrameUrl: userData.avatarFrameUrl, giftIconUrl: userData.giftIconUrl, status: userData.status || "online" },
                memberCount: members.length,
              });

              // Broadcast live counter update globally for the new room
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
            socket.leave(`room:${roomId}`);
            leaveUserFromRoom(socket.id);
            io!.to(`room:${roomId}`).emit("user_left", { socketId: socket.id, username, roomId, memberCount: getRoomCount(roomId) });
            
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
              const filterRes = await filterService.processText({
                text: finalChatText,
                source: roomId,
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
             io!.to(targetSocketId).emit("system_alert", {
               title: action === "ban" ? "حظر" : "طرد",
               message: action === "ban" ? "لقد تم حظرك من الموقع" : "لقد تم طردك من الغرفة",
               from: username
             });
             
             // Disconnect user
             const targetSocket = io!.sockets.sockets.get(targetSocketId);
             if (targetSocket) {
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
              type: "moderation", 
              text: `تم ${action === 'kick' ? 'طرد' : action === 'ban' ? 'حظر' : 'تنبيه'} ${targetUser.username}`, 
              roomId 
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
          const uniqueUsers = new Map<string, any>();
          
          for (const u of connectedUsers.values()) {
            const uniqueKey = getPresenceKey(u);
            const existing = uniqueUsers.get(uniqueKey);
            
            if (!existing) {
              uniqueUsers.set(uniqueKey, {
                id: u.id, socketId: u.socketId, username: u.username, role: u.role, avatar: u.avatar,
                countryCode: u.countryCode, avatarFrameUrl: u.avatarFrameUrl,
                giftIconUrl: u.giftIconUrl, roomId: u.roomId,
                status: u.status || "online",
                idreg: u.idreg, siteBadge: u.siteBadge,
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
          
          const users = Array.from(uniqueUsers.values());
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
          });
        });

        // ===== Profile Update Events =====
        socket.on("profile_update", (data: any) => {
          const user = connectedUsers.get(socket.id);
          if (!user) return;

          const oldUsername = user.username;

          if (data.avatar) user.avatar = data.avatar;
          if (data.avatarFrameUrl) user.avatarFrameUrl = data.avatarFrameUrl;
          if (data.giftIconUrl) user.giftIconUrl = data.giftIconUrl;
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
            messageBubbleStyle: user.messageBubbleStyle,
            profileMsg: data.profileMsg,
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
            const filterRes = await filterService.processText({
              text,
              source: "private",
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

        // ===== Disconnect =====
        socket.on("disconnect", () => {
          if (pendingLeaves.has(socket.id)) {
            clearTimeout(pendingLeaves.get(socket.id)!.timeout);
            pendingLeaves.delete(socket.id);
          }
          const user = connectedUsers.get(socket.id);
          if (user?.roomId) {
            const userKey = user.username;
            if (pendingDisconnects.has(userKey)) {
              clearTimeout(pendingDisconnects.get(userKey)!.timeout);
            }

            const runDisconnect = () => {
              pendingDisconnects.delete(userKey);
              const latestUser = connectedUsers.get(socket.id);
              if (!latestUser) return;
              const roomId = latestUser.roomId;

              io!.to(`room:${roomId}`).emit("user_left", { socketId: socket.id, username, roomId, memberCount: Math.max(0, getRoomCount(roomId) - 1) });
              
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
