/**
 * Room Handlers
 * يدير أحداث WebSocket المتعلقة بالغرف والرسائل مع دمج نظام الفلترة
 */
import type { Server, Socket } from "socket.io";
import { joinRoom, leaveRoom, getRoomMembers, getRoomMemberCount, pendingDisconnects, removeConnectedUser } from "./presenceManager";
import { publishSocketEvent, publishGlobalEvent } from "./SocketBroker";
import { listRooms, addMessage, getRoomMessage, updateRoomMessageReactions, createRoomInDatabase, type RoomReactionType, ROOM_REACTIONS } from "../services/chatStore";
import { processText } from "../services/filterService";
import { applyShortcuts } from "../services/shortcutService";
import { hasPermission } from "../services/permissionEngine";
import { eventBus } from "../core/events/EventBus";
import { bootstrapWorkers } from "../workers";
import { randomUUID } from "node:crypto";

const TYPING_THROTTLE_MS = 900;
const typingTimers = new Map<string, NodeJS.Timeout>();
const pendingLeaves = new Map<string, { roomId: string; timeout: NodeJS.Timeout }>();

export function registerRoomHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user;
  bootstrapWorkers();

  // الانضمام لغرفة تنبيهات المشرفين إذا كان يملك الصلاحية
  if (user.role === 'admin' || user.role === 'owner') {
    socket.join("moderators_alerts");
  }

  socket.on("get_rooms", async (callback?: (res: any) => void) => {
    try {
      const rooms = await listRooms();
      const roomsWithCounts = await Promise.all(
        rooms.map(async (room: any) => ({
          ...room,
          members: await getRoomMemberCount(room.id),
        })),
      );
      callback?.({ success: true, rooms: roomsWithCounts });
    } catch (err) {
      console.error("get_rooms failed:", err);
      callback?.({ success: false, message: "تعذر جلب الغرف" });
    }
  });

  /**
   * إنشاء غرفة جديدة (للمستخدمين الذين لديهم صلاحية createroom)
   */
  socket.on("create_room", async (data: {
    topic: string;
    about: string;
    welcome: string;
    pass?: string;
    max: number;
    like?: number;
    pinned?: boolean;
    broadcast: boolean;
    mic: number;
    pic: string;
    color: string;
    verified: boolean;
    roomLayout: string;
    stageLocks?: Record<string, boolean>;
  }, callback?: (res: any) => void) => {
    try {
      console.log("[create_room] received data:", JSON.stringify({ topic: data?.topic, about: data?.about?.slice(0, 20), broadcast: data?.broadcast, mic: data?.mic }));

      // التحقق من وجود البيانات المطلوبة
      if (!data?.topic || !data?.about || !data?.welcome || data?.max == null) {
        callback?.({ success: false, message: "البيانات المطلوبة غير مكتملة (الاسم، الوصف، رسالة الترحيب، عدد الأعضاء)" });
        return;
      }

      // التحقق من صلاحية إنشاء الغرف
      const userId = String(user.id || "");
      if (!userId) {
        callback?.({ success: false, message: "يجب تسجيل الدخول أولاً" });
        return;
      }
      const canCreate = await hasPermission(userId, "createroom.edit");
      if (!canCreate) {
        callback?.({ success: false, message: "لا تملك صلاحية إنشاء غرف" });
        return;
      }

      // التحقق من عدم وجود غرفة بنفس الاسم
      const rooms = await listRooms();
      if (rooms.some(r => r.name.toLowerCase() === String(data.topic).trim().toLowerCase())) {
        callback?.({ success: false, message: "يوجد غرفة تحمل نفس الاسم بالفعل" });
        return;
      }

      // توليد معرف فريد للغرفة
      const roomId = randomUUID().slice(0, 10);

      // تحديد المالك (رقم العضوية)
      const ownerRef = `#${user.idreg || user.id || "0"}`;

      console.log("[create_room] creating room in DB...");

      // إنشاء الغرفة في قاعدة البيانات
      const created = await createRoomInDatabase({
        id: roomId,
        topic: String(data.topic).trim(),
        about: String(data.about).trim(),
        welcome: String(data.welcome).trim(),
        pass: data.pass || "",
        max: Number(data.max) || 10,
        like: Number(data.like) || 0,
        deleted: false,
        broadcast: Boolean(data.pinned),
        mic: Number(data.mic) || 0,
        pic: data.pic || "room.png",
        color: data.color || "#000000",
        owner: ownerRef,
        user: String(user.username || ""),
        verified: Boolean(data.verified),
        roomLayout: data.roomLayout || "normal",
        stageLocks: data.stageLocks,
      });

      if (!created) {
        console.error("[create_room] DB insert returned falsy");
        callback?.({ success: false, message: "فشل إنشاء الغرفة، تأكد من عدم وجود خلل في البيانات" });
        return;
      }

      console.log("[create_room] room created successfully, id:", roomId);

      // إعادة تحميل الغرف وبثها لجميع المتصلين
      const updatedRooms = await listRooms();
      const roomsWithCounts = await Promise.all(
        updatedRooms.map(async (r: any) => ({
          ...r,
          members: await getRoomMemberCount(r.id),
        })),
      );

      // بث قائمة الغرف المحدثة للجميع
      io.emit("msg", { cmd: "r+", data: roomsWithCounts });
      await publishGlobalEvent("rooms_updated", { rooms: roomsWithCounts });

      callback?.({ success: true, message: "تم إنشاء الغرفة بنجاح", roomId });
    } catch (err) {
      console.error("create_room failed:", err);
      callback?.({ success: false, message: "حدث خطأ أثناء إنشاء الغرفة" });
    }
  });

  /**
   * دخول غرفة
   */
  socket.on("join_room", async (data: { roomId: string }, callback?: (res: any) => void) => {
    const roomId = String(data?.roomId || "").trim();
    if (!roomId) {
      callback?.({ success: false, message: "معرف الغرفة مطلوب" });
      return;
    }

    const pendingLeave = pendingLeaves.get(socket.id);
    let previousRoomId = socket.data.user.roomId;
    if (pendingLeave) {
      clearTimeout(pendingLeave.timeout);
      previousRoomId = pendingLeave.roomId;
      pendingLeaves.delete(socket.id);
    }

  const userKey = user.id;
  const pendingDisconnect = pendingDisconnects.get(userKey);
    let isReconnect = false;

    if (pendingDisconnect) {
      // إلغاء مؤقت الخروج بالكامل!
      clearTimeout(pendingDisconnect.timeout);
      if (pendingDisconnect.presenceTimeout) {
        clearTimeout(pendingDisconnect.presenceTimeout);
      }
  pendingDisconnects.delete(userKey);

      // إزالة السوكت القديم من الحضور فوراً لمنع الازدواجية
      const oldSocketId = pendingDisconnect.socketId;
      await removeConnectedUser(oldSocketId);

      if (pendingDisconnect.roomId === roomId) {
        isReconnect = true;
      } else {
        previousRoomId = pendingDisconnect.roomId;
      }
    }
    
    // Resolve room names and images for system messages
    let roomName = roomId;
    let roomImage = "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop";
    let prevRoomName = previousRoomId || "";
    try {
      const rooms = await listRooms();
      const currentRoom = rooms.find((r: any) => r.id === roomId);
      if (currentRoom) {
        roomName = currentRoom.name;
        roomImage = currentRoom.image || roomImage;
      }
      if (previousRoomId) {
        const oldRoom = rooms.find((r: any) => r.id === previousRoomId);
        if (oldRoom) prevRoomName = oldRoom.name;
      }
    } catch (e) {
      console.error("Error listing rooms inside join_room production resolver:", e);
    }

    if (previousRoomId && previousRoomId !== roomId) {
      socket.leave(`room:${previousRoomId}`);
      await leaveRoom(socket.id);
      eventBus.publish({
        type: "room.left",
        stream: "rooms",
        actor: { id: user.id, username: user.username, role: user.role, socketId: socket.id, ip: socket.handshake.address },
        target: { id: previousRoomId, type: "room", roomId: previousRoomId },
        payload: { roomId: previousRoomId, username: user.username },
        metadata: { roomId: previousRoomId, source: "socket.roomHandlers", shardKey: previousRoomId },
      }).catch(err => console.error("EventBus publish failed (room.left):", err));

      const memberCount = await getRoomMemberCount(previousRoomId);
      await publishSocketEvent(previousRoomId, "user_left", {
        socketId: socket.id,
        username: user.username,
        roomId: previousRoomId,
        memberCount,
      });

      // Broadcast transition system message to previous room
      await publishSocketEvent(previousRoomId, "system_message", {
        text: `قام بالانتقال إلى الغرفة: ${roomName}`,
        roomId: previousRoomId,
        systemType: "transition",
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          avatar: user.avatar,
          countryCode: user.countryCode,
          avatarFrameUrl: user.avatarFrameUrl,
          giftIconUrl: user.giftIconUrl,
        },
        targetRoom: {
          id: roomId,
          name: roomName,
          image: roomImage,
        }
      });

      // Broadcast live counter update globally for the previous room
      await publishGlobalEvent("room_count_update", { roomId: previousRoomId, memberCount });
    }

    socket.join(`room:${roomId}`);
    await joinRoom(socket.id, roomId);
    socket.data.user.roomId = roomId;

    eventBus.publish({
      type: "room.joined",
      stream: "rooms",
      actor: { id: user.id, username: user.username, role: user.role, socketId: socket.id, ip: socket.handshake.address },
      target: { id: roomId, type: "room", roomId },
      payload: { roomId, username: user.username },
      metadata: { roomId, source: "socket.roomHandlers", shardKey: roomId },
    }).catch(err => console.error("EventBus publish failed (room.joined):", err));

    const members = await getRoomMembers(roomId);
    callback?.({
      success: true,
      roomId,
      messages: [],
      members: members.map((m) => ({
        id: m.id,
        username: m.username,
        role: m.role,
        avatar: m.avatar,
        countryCode: m.countryCode,
        avatarFrameUrl: m.avatarFrameUrl,
        giftIconUrl: m.giftIconUrl,
        status: m.status || "online",
        nameColor: m.nameColor || "",
      })),
      memberCount: members.length,
    });

    if (!isReconnect) {
      await publishSocketEvent(roomId, "user_joined", {
        socketId: socket.id,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          avatar: user.avatar,
          countryCode: user.countryCode,
          avatarFrameUrl: user.avatarFrameUrl,
          giftIconUrl: user.giftIconUrl,
          status: user.status || "online",
          nameColor: socket.data.user.nameColor || "",
        },
        memberCount: members.length,
      }, socket.id);

      // Broadcast live counter update globally for the joined room
      await publishGlobalEvent("room_count_update", { roomId, memberCount: members.length });

      // Broadcast transition/entrance system message to the new room
      if (previousRoomId && previousRoomId !== roomId) {
        await publishSocketEvent(roomId, "system_message", {
          text: `دخل الغرفة (انتقل من: ${prevRoomName})`,
          roomId,
          systemType: "join",
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            avatar: user.avatar,
            countryCode: user.countryCode,
            avatarFrameUrl: user.avatarFrameUrl,
            giftIconUrl: user.giftIconUrl,
          }
        });
      } else {
        await publishSocketEvent(roomId, "system_message", {
          text: `دخل الغرفة`,
          roomId,
          systemType: "join",
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            avatar: user.avatar,
            countryCode: user.countryCode,
            avatarFrameUrl: user.avatarFrameUrl,
            giftIconUrl: user.giftIconUrl,
          }
        });
      }
    }
  });

  /**
   * إرسال رسالة في غرفة (مع الفلترة)
   */
  socket.on("room_message", async (data: { roomId: string; text: string; clientId?: string; replyToId?: string; replyToText?: string; replyToSenderName?: string; mediaUrl?: string; mediaUrls?: string[]; mediaType?: "image" | "video" | "audio"; sticker?: string; animatedFaces?: string[] }, callback?: (res: any) => void) => {
    try {
      const roomId = String(data?.roomId || "").trim();
      const text = String(data?.text || "").trim();
      const clientId = data?.clientId;
      const replyToId = data?.replyToId || "";
      const clientReplyToText = data?.replyToText || "";
      const clientReplyToSenderName = data?.replyToSenderName || "";
      const mediaUrl = data?.mediaUrl || "";
      const mediaType = data?.mediaType;

      if (!roomId || (!text && !mediaUrl && !data?.sticker && !data?.animatedFaces?.length)) {
        callback?.({ success: false, message: "البيانات ناقصة" });
        return;
      }

      // --- تطبيق الاختصارات ثم الفلترة الذكية ---
      const rawText = text || (mediaType === "audio" ? "🎤 رسالة صوتية" : "");
      const finalText = rawText ? await applyShortcuts(rawText) : rawText;
      let roomDisplayName = roomId;
      try {
        const rooms = await listRooms();
        const found = rooms.find((r: any) => r.id === roomId);
        if (found) roomDisplayName = found.name;
      } catch {}
      const filterResult = finalText ? await processText({
        text: finalText,
        source: `غرفة: ${roomDisplayName}`,
        user: {
          username: user.username,
          topic: user.username,
          ip: socket.handshake.address || "127.0.0.1",
        },
      }) : { filteredText: finalText };

      // ─── جلب بيانات الرسالة المردود عليها ──────────────────────────────────
      let replyToText = "";
      let replyToSenderName = "";
      if (replyToId) {
        const parentMsg = getRoomMessage(roomId, replyToId);
        if (parentMsg) {
          replyToText = parentMsg.text || "";
          replyToSenderName = parentMsg.user || "";
        } else {
          // استخدام البيانات المرسلة من العميل كبديل
          replyToText = clientReplyToText || "";
          replyToSenderName = clientReplyToSenderName || "";
        }
      }

      // إنشاء وحفظ الرسالة (باستخدام النص المفلتر)
      const message = addMessage({
        roomId,
        clientId,
        user: user.username,
        userId: String(user.id || ""),
        role: user.role,
        countryCode: user.countryCode,
        avatar: user.avatar,
        avatarFrameUrl: user.avatarFrameUrl,
        giftIconUrl: user.giftIconUrl,
        messageBubbleStyle: user.messageBubbleStyle,
        nameColor: socket.data.user.nameColor || "",
        text: filterResult.filteredText,
        replyToId: replyToId || undefined,
        replyToText: replyToText || undefined,
        replyToSenderName: replyToSenderName || undefined,
        mediaUrl: mediaUrl || undefined,
        mediaUrls: data?.mediaUrls || undefined,
        mediaType: mediaType || undefined,
        sticker: data?.sticker || undefined,
        animatedFaces: data?.animatedFaces && data.animatedFaces.length > 0 ? data.animatedFaces : undefined,
      });

      publishSocketEvent(roomId, "new_message", {
        roomId,
        message,
      }).catch((err) => console.error("publish room message failed:", err));

      callback?.({ success: true, message });
    } catch (error) {
      console.error("room_message failed:", error);
      callback?.({ success: false, message: "تعذر إرسال الرسالة" });
    }
  });

  // ─── تفاعل على رسالة في غرفة ──────────────────────────────────────────────

  socket.on("room:react", async (
    data: { roomId: string; messageId: string; reaction: RoomReactionType },
    callback?: (res: any) => void,
  ) => {
    try {
      const roomId = String(data?.roomId || "").trim();
      const messageId = String(data?.messageId || "").trim();
      const reaction = data?.reaction;

      if (!roomId || !messageId || !reaction) {
        return callback?.({ success: false, error: "بيانات ناقصة" });
      }

      if (!ROOM_REACTIONS.includes(reaction)) {
        return callback?.({ success: false, error: "نوع تفاعل غير صالح" });
      }

      const msg = getRoomMessage(roomId, messageId);
      if (!msg) {
        return callback?.({ success: false, error: "الرسالة غير موجودة" });
      }

      if (!msg.reactions) msg.reactions = {};

      const userId = String(user.id || user.username || socket.id);
      const existingReaction = msg.reactions[userId];

      if (existingReaction === reaction) {
        delete msg.reactions[userId];
      } else {
        msg.reactions[userId] = reaction;
      }

      updateRoomMessageReactions(roomId, messageId, msg.reactions);

      // بث التحديث لجميع أعضاء الغرفة
      await publishSocketEvent(roomId, "room_reaction", {
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

  socket.on("typing", async (data: { roomId: string }) => {
    const roomId = String(data?.roomId || "").trim();
    if (!roomId) return;
    const key = `${socket.id}:${roomId}`;
    if (typingTimers.has(key)) return;
    typingTimers.set(key, setTimeout(() => typingTimers.delete(key), TYPING_THROTTLE_MS));
    await publishSocketEvent(roomId, "user_typing", { socketId: socket.id, username: user.username, roomId }, socket.id);
  });

  socket.on("stop_typing", async (data: { roomId: string }) => {
    const roomId = String(data?.roomId || "").trim();
    if (!roomId) return;
    await publishSocketEvent(roomId, "user_stop_typing", { socketId: socket.id, username: user.username, roomId }, socket.id);
  });

  socket.on("leave_room", async (data: { roomId: string }) => {
    const roomId = String(data?.roomId || "").trim();
    if (!roomId) return;

    if (pendingLeaves.has(socket.id)) {
      clearTimeout(pendingLeaves.get(socket.id)!.timeout);
      pendingLeaves.delete(socket.id);
    }

    const runLeave = async () => {
      pendingLeaves.delete(socket.id);
      socket.leave(`room:${roomId}`);
      await leaveRoom(socket.id);
      if (socket.data.user.roomId === roomId) {
        socket.data.user.roomId = "";
      }
      const memberCount = await getRoomMemberCount(roomId);
      await publishSocketEvent(roomId, "user_left", {
        socketId: socket.id,
        username: user.username,
        roomId,
        memberCount,
      });

      // Broadcast leave system message
      await publishSocketEvent(roomId, "system_message", {
        text: `غادر الغرفة`,
        roomId,
        systemType: "leave",
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          avatar: user.avatar,
          countryCode: user.countryCode,
          avatarFrameUrl: user.avatarFrameUrl,
          giftIconUrl: user.giftIconUrl,
        }
      });

      // Broadcast live counter update globally
      await publishGlobalEvent("room_count_update", { roomId, memberCount });
    };

    const timeout = setTimeout(() => {
      runLeave().catch(err => console.error("Delayed leave failed:", err));
    }, 250);

    pendingLeaves.set(socket.id, { roomId, timeout });
  });

  socket.on("disconnect", async () => {
    if (pendingLeaves.has(socket.id)) {
      clearTimeout(pendingLeaves.get(socket.id)!.timeout);
      pendingLeaves.delete(socket.id);
    }
    const roomId = socket.data.user.roomId;
    if (roomId) {
      const userKey = user.username;

      if (pendingDisconnects.has(userKey)) {
        clearTimeout(pendingDisconnects.get(userKey)!.timeout);
      }

      const runDisconnect = async () => {
        pendingDisconnects.delete(userKey);

        eventBus.publish({
          type: "room.left",
          stream: "rooms",
          actor: { id: user.id, username: user.username, role: user.role, socketId: socket.id, ip: socket.handshake.address },
          target: { id: roomId, type: "room", roomId },
          payload: { roomId, username: user.username, disconnected: true },
          metadata: { roomId, source: "socket.roomHandlers.disconnect", shardKey: roomId },
        }).catch(err => console.error("EventBus publish failed (room.left on disconnect):", err));

        const memberCount = await getRoomMemberCount(roomId);
        await publishSocketEvent(roomId, "user_left", {
          socketId: socket.id,
          username: user.username,
          roomId,
          memberCount: Math.max(0, memberCount),
        });

        // Broadcast leave system message on disconnect
        await publishSocketEvent(roomId, "system_message", {
          text: `غادر الغرفة (انقطع الاتصال)`,
          roomId,
          systemType: "leave",
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            avatar: user.avatar,
            countryCode: user.countryCode,
            avatarFrameUrl: user.avatarFrameUrl,
            giftIconUrl: user.giftIconUrl,
          }
        });
      };

      const timeout = setTimeout(() => {
        runDisconnect().catch(err => console.error("Delayed disconnect failed:", err));
      }, 3000);

      const existing = pendingDisconnects.get(userKey);
      if (existing) {
        existing.timeout = timeout;
      } else {
        // presenceTimeout is required by the pendingDisconnects shape; reuse the same timeout as a placeholder
        pendingDisconnects.set(userKey, {
          roomId,
          timeout,
          presenceTimeout: timeout,
          socketId: socket.id,
          userData: { ...user }
        });
      }
    }
  });
}
