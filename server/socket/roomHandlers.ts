import { dbPool } from "../db/index";
import { addUserExp, canGainChatExp } from "../services/userLevelService";
import { setRoomMemberRole, getRoomMember } from "../services/roomMemberService";
/**
 * Room Handlers
 * يدير أحداث WebSocket المتعلقة بالغرف والرسائل مع دمج نظام الفلترة
 */
import type { Server, Socket } from "socket.io";
import { joinRoom, leaveRoom, getRoomMembers, getRoomMemberCount, pendingDisconnects, removeConnectedUser, emitRoomCount, getTotalOnlineCount } from "./presenceManager";
import { publishSocketEvent, publishGlobalEvent } from "./SocketBroker";
import { listRooms, addMessage, getRoomMessage, updateRoomMessageReactions, createRoomInDatabase, type RoomReactionType, ROOM_REACTIONS } from "../services/chatStore";
import { processText } from "../services/filterService";
import { applyShortcuts } from "../services/shortcutService";
import { hasPermission } from "../services/permissionEngine";
import { getMessagePermissionRequirements } from "../../src/lib/chatFeaturePermissions";
import { hasChatFeatureAccess } from "../services/chatAuthorization";
import { eventBus } from "../core/events/EventBus";
import { bootstrapWorkers } from "../workers";
import { randomUUID } from "node:crypto";
import { vacateUserFromAllSeats } from "./voiceStageHandlers";
import { disconnectConfiguredLiveKitParticipant } from "../services/livekitVoicePermissions";

const TYPING_THROTTLE_MS = 900;
const typingTimers = new Map<string, NodeJS.Timeout>();
const pendingLeaves = new Map<string, { roomId: string; timeout: NodeJS.Timeout }>();

export function registerRoomHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user;
  bootstrapWorkers();
  const disconnectLiveKitParticipant = async (roomId: string) => {
    try {
      await disconnectConfiguredLiveKitParticipant(roomId, String(user.id || ""));
    } catch (error) {
      console.error("[LiveKit] Failed to disconnect participant after leaving room", {
        roomId,
        identity: String(user.id || ""),
        error,
      });
    }
  };

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
      callback?.({ success: true, rooms: roomsWithCounts.sort((a: any, b: any) => (b.members || 0) - (a.members || 0)) });
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
    slug?: string;
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
    ownerUsername?: string;
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
      let ownerRef = `#${user.idreg || user.id || "0"}`;
      let ownerUser = String(user.username || "");
      let ownerId: string | null = user.id || null;
      if (data.ownerUsername && data.ownerUsername !== "system") {
        const { dbPool } = await import("../db");
        const ownerResult = await dbPool.query(
          "SELECT id, idreg, username FROM users WHERE username = $1 LIMIT 1",
          [data.ownerUsername]
        );
        if ((ownerResult.rowCount || 0) > 0) {
          ownerRef = `#${ownerResult.rows[0].idreg}`;
          ownerUser = ownerResult.rows[0].username;
          // استخراج UUID الحقيقي للمالك لحفظه في owner_id (Fix #10)
          ownerId = ownerResult.rows[0].id || user.id || null;
        }
      }

      // Resolve slug
      const safeSlug = data.slug
        ? String(data.slug).toLowerCase().replace(/[^a-z0-9_-]/g, "")
        : roomId;

      console.log("[create_room] creating room in DB...");

      // إنشاء الغرفة في قاعدة البيانات
      const created = await createRoomInDatabase({
        id: safeSlug,
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
        owner_id: ownerId,
      });

      if (!created) {
        console.error("[create_room] DB insert returned falsy");
        callback?.({ success: false, message: "فشل إنشاء الغرفة، تأكد من عدم وجود خلل في البيانات" });
        return;
      }

      console.log("[create_room] room created successfully, id:", roomId);

      // إعادة تحميل الغرف وبثها لجميع المتصلين
      const updatedRooms = await listRooms();
      const roomsWithCounts = (await Promise.all(
        updatedRooms.map(async (r: any) => ({
          ...r,
          members: await getRoomMemberCount(r.id),
        })),
      )).sort((a: any, b: any) => (b.members || 0) - (a.members || 0));

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
   * تعديل غرفة
   */
  socket.on("edit_room", async (data: any, callback?: (res: any) => void) => {
    try {
      const roomId = String(data?.roomId || "").trim();
      if (!roomId) { callback?.({ success: false, message: "معرف الغرفة مطلوب" }); return; }

      const { dbPool } = await import("../db");

      // Check permission: owner of room or has room.edit / room.all
      const roomCheck = await dbPool.query(
        "SELECT owner, \"user\" FROM rooms WHERE CAST(id AS text) = $1 OR slug = $1 LIMIT 1",
        [roomId]
      );
      const roomRow = roomCheck.rows[0];
      if (!roomRow) { callback?.({ success: false, message: "الغرفة غير موجودة" }); return; }

      const isOwner = String(roomRow["user"] || "") === String(user.username || "");
      let canEdit = isOwner;
      if (!canEdit) {
        try {
          const { hasPermission } = await import("../services/adminPermissions");
          canEdit = await hasPermission(String(user.id || ""), "room.edit") || await hasPermission(String(user.id || ""), "room.all") || await hasPermission(String(user.id || ""), "rooms.edit") || await hasPermission(String(user.id || ""), "rooms.all");
        } catch (_) {}
      }
      if (!canEdit) {
        callback?.({ success: false, message: "ليس لديك صلاحية لتعديل هذه الغرفة" });
        return;
      }

      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (data.topic !== undefined) { fields.push(`topic = $${idx++}`); values.push(String(data.topic).trim()); }
      if (data.about !== undefined) { fields.push(`about = $${idx++}`); values.push(String(data.about).trim()); }
      if (data.welcome !== undefined) { fields.push(`welcome = $${idx++}`); values.push(String(data.welcome).trim()); }
      if (data.pass !== undefined) { fields.push(`pass = $${idx++}`); values.push(String(data.pass)); fields.push(`needpass = $${idx++}`); values.push(data.pass ? 1 : 0); }
      if (data.max !== undefined) { fields.push(`max = $${idx++}`); values.push(Number(data.max) || 10); }
      if (data.like !== undefined) { fields.push(`rmli = $${idx++}`); values.push(Number(data.like) || 0); }
      if (data.mic !== undefined) { fields.push(`mic = $${idx++}`); values.push(Number(data.mic) || 0); }
      if (data.broadcast !== undefined) { fields.push(`broadcast = $${idx++}`); values.push(data.broadcast ? 1 : 0); }
      if (data.pic !== undefined) { fields.push(`pic = $${idx++}`); values.push(String(data.pic)); }
      if (data.color !== undefined) { fields.push(`color = $${idx++}`); values.push(String(data.color)); }
      if (data.verified !== undefined) { fields.push(`verified = $${idx++}`); values.push(data.verified ? true : false); }
      if (data.roomLayout !== undefined) { fields.push(`room_layout = $${idx++}`); values.push(String(data.roomLayout)); }
      if (data.stageLocks !== undefined) {
        const stageState = JSON.stringify(
          Object.fromEntries(
            Object.entries(data.stageLocks).map(([k, v]) => [k, v ? 1 : 0])
          )
        );
        fields.push(`stage_state = $${idx++}`); values.push(stageState);
      }
      if (data.slug !== undefined) {
        const safeSlug = String(data.slug).toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (safeSlug) { fields.push(`slug = $${idx++}`); values.push(safeSlug); }
      }

      if (fields.length === 0) { callback?.({ success: false, message: "لا توجد بيانات للتعديل" }); return; }

      values.push(roomId);
      await dbPool.query(
        `UPDATE rooms SET ${fields.join(", ")} WHERE CAST(id AS text) = $${idx} OR slug = $${idx}`,
        values
      );

      const updatedRooms = await listRooms();
      const roomsWithCounts = await Promise.all(
        updatedRooms.map(async (r: any) => ({
          ...r,
          members: await getRoomMemberCount(r.id),
        })),
      ).sort((a: any, b: any) => (b.members || 0) - (a.members || 0));

      io.emit("msg", { cmd: "r+", data: roomsWithCounts });
      await publishGlobalEvent("rooms_updated", { rooms: roomsWithCounts });

      // Emit real-time update to users inside this room
      const updatedRoom = roomsWithCounts.find((r: any) => String(r.id) === String(roomId) || String(r.id) === String(data.slug));
      if (updatedRoom) {
        io.to(`room:${roomId}`).emit("room_updated", { roomId, room: updatedRoom });
      }

      callback?.({ success: true, message: "تم تعديل الغرفة بنجاح" });
    } catch (err) {
      console.error("edit_room failed:", err);
      callback?.({ success: false, message: "حدث خطأ أثناء تعديل الغرفة" });
    }
  });

  /**
   * دخول غرفة
   */
  socket.on("join_room", async (data: { roomId: string; password?: string }, callback?: (res: any) => void) => {
    const roomId = String(data?.roomId || "").trim();
    if (!roomId) {
      callback?.({ success: false, message: "معرف الغرفة مطلوب" });
      return;
    }

    // ── Check if user is temporarily kicked/banned from this room ──
    try {
      const { dbPool } = await import("../db");
      const { resolveRoomId, resolveRoomIdVariants, normalizeRoomIdValue } = await import("./roomAccess");
      const uid = String(user.id || "");
      const uname = String(user.username || "").toLowerCase();
      const uidreg = String(user.idreg || "");
      const roomIdVariants = await resolveRoomIdVariants(roomId);
      const canonicalRoomId = await resolveRoomId(roomId);
      const roomCheckValues = Array.from(new Set([canonicalRoomId, roomId, ...roomIdVariants, normalizeRoomIdValue(roomId), normalizeRoomIdValue(canonicalRoomId)].filter(Boolean)));
      const normalizedRoomCheckValues = roomCheckValues.map((value) => normalizeRoomIdValue(value).toLowerCase());
      console.log(`[JOIN_ROOM_TRACE] incoming`, JSON.stringify({ socketId: socket.id, userId: uid, userName: user.username, userIdReg: uidreg, requestedRoomId: roomId, canonicalRoomId, roomIdVariants, roomCheckValues, normalizedRoomCheckValues }));

      // خطوة 1: جلب الهوية الصحيحة للمستخدم من جدول users
      // user.id قد يكون uid أو UUID أو idreg - نبحث بكل الصيغ
      let realUserId = uid;
      let resolvedIdentifiers: string[] = [];
      try {
        const userLookup = await dbPool.query(
          `SELECT CAST(id AS text) as id, CAST(uid AS text) as uid, CAST(idreg AS varchar) as idreg, username
           FROM users
           WHERE lower(username) = lower($1)
              OR CAST(id AS text) = $2
              OR CAST(uid AS text) = $2
              OR CAST(idreg AS varchar) = $3
           ORDER BY CASE WHEN lower(username) = lower($1) THEN 0 ELSE 1 END
           LIMIT 1`,
          [uname, uid, uidreg, uname]
        );
        if (userLookup.rows[0]?.id) {
          realUserId = userLookup.rows[0].id;
        }

        const row = userLookup.rows[0];
        const candidateValues = [
          uid,
          uidreg,
          uname,
          String(realUserId || ""),
          String(row?.uid || ""),
          String(row?.idreg || ""),
          String(row?.username || ""),
        ];
        resolvedIdentifiers = Array.from(new Set(candidateValues.filter((value) => String(value).trim())));
        console.log(`[JOIN_ROOM_TRACE] userLookup`, JSON.stringify({ rowCount: userLookup.rowCount, row: row || null, realUserId, resolvedIdentifiers }));
      } catch (_) {
        resolvedIdentifiers = Array.from(new Set([uid, uidreg, uname].filter((value) => String(value).trim())));
      }

      // خطوة 2: فحص الطرد عبر جميع المعرفات الممكنة للمستخدم
      const checkValues = roomCheckValues.length > 0 ? roomCheckValues : [canonicalRoomId, roomId];
      const kickRes = await dbPool.query(
        `SELECT k.banned_until, k.user_id, k.room_id 
         FROM room_kicks k
         WHERE (
             k.room_id = ANY($1::text[])
             OR lower(k.room_id) = ANY($2::text[])
             OR lower(regexp_replace(k.room_id, '^(room|social|channel|chat):', '')) = ANY($3::text[])
           )
           AND (
             k.user_id = ANY($4::text[])
             OR lower(k.user_id) = ANY($5::text[])
           )
         ORDER BY k.banned_until DESC
         LIMIT 1`,
        [checkValues, checkValues.map((value) => value.toLowerCase()), normalizedRoomCheckValues, resolvedIdentifiers, resolvedIdentifiers.map((value) => value.toLowerCase())]
      );
      console.log(`[JOIN_ROOM_TRACE] kickQuery`, JSON.stringify({ checkValues, normalizedRoomCheckValues, identifiers: resolvedIdentifiers, rowCount: kickRes.rowCount, row: kickRes.rows[0] || null }));
      if (kickRes.rows.length > 0) {
        const bannedUntil = new Date(kickRes.rows[0].banned_until);
        const now = new Date();
        const remaining = bannedUntil.getTime() - now.getTime();
        console.log(`[KICK_BAN_CHECK] bannedUntil=${bannedUntil.toISOString()} now=${now.toISOString()} remaining_ms=${remaining}`);
        if (remaining > 0) {
          const diffMins = Math.floor(remaining / 60000);
          const diffSecs = Math.floor((remaining % 60000) / 1000);
          let timeRemainingStr = "";
          if (diffMins > 0) {
            timeRemainingStr = `${diffMins} دقيقة و ${diffSecs} ثانية`;
          } else {
            timeRemainingStr = `${diffSecs} ثانية`;
          }
          console.log(`[KICK_BAN_CHECK] BLOCKING entry. timeRemaining=${timeRemainingStr}`);
          socket.emit("room_kicked", {
            roomId: canonicalRoomId,
            duration: Math.max(1, Math.ceil(remaining / 60000)),
            message: `تم طردك من الغرفة مؤقتاً ومتبقي لديك ${timeRemainingStr}`,
          });
          socket.emit("system_alert", {
            title: "منع الدخول",
            message: `لا يمكنك الدخول للغرفة حالياً لأنك طُردت مؤقتاً ومتبقي لديك ${timeRemainingStr}`,
            from: "النظام",
          });
          callback?.({
            success: false,
            message: `لا يمكنك الدخول للغرفة، تم طردك مؤقتاً ومتبقي لديك ${timeRemainingStr}`,
          });
          return;
        }
      }
    } catch (e) {
      console.error("Room kick check error:", e);
    }

    // ── ترطيب حالة الكتم الغرفي للغرفة (فصل عن الكتم العام) ──
    try {
      let muteCanonicalRoomId = roomId;
      try {
        const { resolveRoomId } = await import("./roomAccess");
        muteCanonicalRoomId = (await resolveRoomId(roomId)) || roomId;
      } catch (_) {}
      const { roomMuteService } = await import("../services/roomMuteService");
      const userMutedRooms = (socket.data.user as any).roomMutedRooms instanceof Set
        ? (socket.data.user as any).roomMutedRooms
        : ((socket.data.user as any).roomMutedRooms = new Set<string>());
      const wasRoomMuted = userMutedRooms.has(muteCanonicalRoomId) || userMutedRooms.has(roomId);
      const isRoomMuted = await roomMuteService.isRoomMutedForUser([muteCanonicalRoomId, roomId], String(user.id || ""));
      if (isRoomMuted) {
        userMutedRooms.add(muteCanonicalRoomId);
        userMutedRooms.add(roomId);
        userMutedRooms.add(`room:${muteCanonicalRoomId}`);
        userMutedRooms.add(`room:${roomId}`);
      } else {
        userMutedRooms.delete(muteCanonicalRoomId);
        userMutedRooms.delete(roomId);
        userMutedRooms.delete(`room:${muteCanonicalRoomId}`);
        userMutedRooms.delete(`room:${roomId}`);
      }
      // إبلاغ العميل بحالة الكتم لهذه الغرفة فقط عند أول دخول أو عند التغيير
      if (isRoomMuted || wasRoomMuted) {
        socket.emit("muted_state", {
          muted: Boolean((socket.data.user as any).muted),
          roomMuted: isRoomMuted,
          roomId: muteCanonicalRoomId,
        });
      }
    } catch (e) {
      console.warn("Room mute hydration failed:", e);
    }

    // جلب قائمة الغرف مرة واحدة وإعادة استخدامها في كل الفحوصات (Fix #9)
    let allRooms: Awaited<ReturnType<typeof listRooms>> = [];
    try {
      allRooms = await listRooms();
    } catch (e) {
      console.error("Error fetching rooms in join_room:", e);
    }

    // ── Password check for locked rooms ──
    try {
      const rooms = allRooms;
      const room = rooms.find((r: any) => String(r.id) === String(canonicalRoomId) || String(r.id) === String(roomId));
      if (room?.locked) {
        let canBypass = false;
        try {
          const { hasPermission } = await import("../services/adminPermissions");
          canBypass = await hasPermission(String(user.id || ""), "lockedroom.read");
        } catch (_) {}

        if (!canBypass) {
          const { dbPool } = await import("../db");
          const roomPassResult = await dbPool.query(
            "SELECT pass FROM rooms WHERE CAST(id AS text) = $1 OR slug = $1 LIMIT 1",
            [roomId]
          );
          const dbPass = roomPassResult.rows[0]?.pass || "";
          const providedPass = String(data?.password || "");
          if (!dbPass || providedPass !== dbPass) {
            callback?.({ success: false, message: "كلمة المرور غير صحيحة", needPassword: true });
            return;
          }
        }
      }
    } catch (e) {
      console.error("Password check error:", e);
    }

    // ── Likes required check ──
    try {
      const roomInfo = allRooms.find((r: any) => String(r.id) === String(canonicalRoomId) || String(r.id) === String(roomId));
      if (roomInfo && roomInfo.likesRequired > 0) {
        let userLikes = 0;
        try {
          const { dbPool } = await import("../db");
          const likesResult = await dbPool.query(
            `SELECT COALESCE(wall_post_likes, 0) as likes FROM users WHERE CAST(id AS text) = $1 OR CAST(uid AS text) = $1 OR CAST(idreg AS varchar) = $1 OR lower(username) = lower($1) LIMIT 1`,
            [String(user.id || "")]
          );
          userLikes = Number(likesResult.rows[0]?.likes || 0);
        } catch (_) {}
        if (userLikes < roomInfo.likesRequired) {
          callback?.({ success: false, message: `يجب أن يكون لديك ${roomInfo.likesRequired} إعجاب على الأقل للدخول لهذه الغرفة (لديك ${userLikes})`, likesRequired: true });
          return;
        }
      }
    } catch (e) {
      console.error("Likes required check error:", e);
    }

    // ── Max capacity check ──
    try {
      const roomInfo = allRooms.find((r: any) => String(r.id) === String(canonicalRoomId) || String(r.id) === String(roomId));
      const currentCount = await getRoomMemberCount(canonicalRoomId);
      const maxMembers = roomInfo?.maxMembers || 50;
      if (currentCount >= maxMembers) {
        callback?.({ success: false, message: "الغرفة ممتلئة حالياً، لا يمكنك الدخول", full: true });
        return;
      }
    } catch (e) {
      console.error("Max capacity check error:", e);
    }

    const pendingLeave = pendingLeaves.get(socket.id);
    let previousRoomId = socket.data.user.roomId;
    if (pendingLeave) {
      clearTimeout(pendingLeave.timeout);
      previousRoomId = pendingLeave.roomId;
      pendingLeaves.delete(socket.id);
    }

    let isReconnect = false;

    // البحث عن معلّقات قطع اتصال لهذه الجلسة أو لأي جلسة سابقة لنفس المستخدم
    // (المفاتيح الآن socketId لكل جلسة — نمسح البنية بدلاً من المفتاح المباشر)
    for (const [pKey, pEntry] of Array.from(pendingDisconnects.entries())) {
      const isOwn = pKey === socket.id || pEntry.socketId === socket.id;
      const isSameUser = String((pEntry.userData as any)?.id || "") === String(user.id);
      if (!isOwn && !isSameUser) continue;

      // إلغاء مؤقت الخروج بالكامل!
      if (pEntry.timeout) clearTimeout(pEntry.timeout);
      if (pEntry.presenceTimeout) clearTimeout(pEntry.presenceTimeout);
      pendingDisconnects.delete(pKey);

      // إزالة السوكت القديم من الحضور فوراً لمنع الازدواجية
      const oldSocketId = pEntry.socketId;
      if (oldSocketId !== socket.id) {
        await removeConnectedUser(oldSocketId);
      }

      if (pEntry.roomId === roomId) {
        isReconnect = true;
      } else {
        previousRoomId = pEntry.roomId;
      }
    }
    
    // Resolve room names and images for system messages
    let roomName = roomId;
    let roomImage = "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=400&fit=crop";
    let prevRoomName = previousRoomId || "";
    try {
      const rooms = allRooms;
      const currentRoom = rooms.find((r: any) => String(r.id) === String(canonicalRoomId) || String(r.id) === String(roomId));
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

    if (previousRoomId && previousRoomId !== canonicalRoomId) {
      console.log(`[TRANSITION_TRACE] === START TRANSITION user=${user.username}(id=${user.id}) socket=${socket.id} fromRoom=${previousRoomId} toRoom=${canonicalRoomId} ===`);
      const prevCountBefore = await getRoomMemberCount(previousRoomId);
      console.log(`[TRANSITION_TRACE] before leave: previousRoom=${previousRoomId} memberCount=${prevCountBefore}`);

      socket.leave(`room:${previousRoomId}`);
      await leaveRoom(socket.id, previousRoomId);
      await disconnectLiveKitParticipant(previousRoomId);
      await vacateUserFromAllSeats(user.id, io, user.username);

      const prevCountAfter = await getRoomMemberCount(previousRoomId);
      try {
        const prevSockets = await io.in(`room:${previousRoomId}`).fetchSockets();
        console.log(`[TRANSITION_TRACE] after leave: previousRoom=${previousRoomId} io_sockets=${prevSockets.length} presenceMemberCount=${prevCountAfter} ids=${JSON.stringify(prevSockets.map(s=>s.id))}`);
      } catch (err) {
        console.warn('[JOIN_ROOM_TRACE] failed to fetch sockets for previous room:', err);
      }
      eventBus.publish({
        type: "room.left",
        stream: "rooms",
        actor: { id: user.id, username: user.username, role: user.role, socketId: socket.id, ip: socket.handshake.address },
        target: { id: previousRoomId, type: "room", roomId: previousRoomId },
        payload: { roomId: previousRoomId, username: user.username },
        metadata: { roomId: previousRoomId, source: "socket.roomHandlers", shardKey: previousRoomId },
      }).catch(err => console.error("EventBus publish failed (room.left):", err));

      const memberCount = await getRoomMemberCount(previousRoomId);
      console.log(`[TRANSITION_TRACE] emitting user_left to previousRoom=${previousRoomId} memberCount=${memberCount}`);
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
          id: canonicalRoomId,
          name: roomName,
          image: roomImage,
        }
      });

      // Broadcast live counter update globally for the previous room
      console.log(`[TRANSITION_TRACE] emitting room_count_update for previousRoom=${previousRoomId} memberCount=${memberCount}`);
      await emitRoomCount(previousRoomId);
    } else {
      console.log(`[TRANSITION_TRACE] NO previousRoomId transition for user=${user.username} socket=${socket.id} -> room=${canonicalRoomId} previousRoomId=${previousRoomId}`);
    }

    const newRoomCountBefore = await getRoomMemberCount(canonicalRoomId);
    console.log(`[TRANSITION_TRACE] before join: newRoom=${canonicalRoomId} memberCount=${newRoomCountBefore}`);

    socket.join(`room:${canonicalRoomId}`);
    await joinRoom(socket.id, canonicalRoomId);
    await vacateUserFromAllSeats(user.id, io, user.username);
    socket.data.user.roomId = canonicalRoomId;

    const newRoomCountAfter = await getRoomMemberCount(canonicalRoomId);
    try {
      const currentSockets = await io.in(`room:${canonicalRoomId}`).fetchSockets();
      console.log(`[TRANSITION_TRACE] after join: newRoom=${canonicalRoomId} io_sockets=${currentSockets.length} presenceMemberCount=${newRoomCountAfter} ids=${JSON.stringify(currentSockets.map(s=>s.id))} socketRooms=${JSON.stringify(Array.from(socket.rooms))}`);
    } catch (err) {
      console.warn('[JOIN_ROOM_TRACE] failed to fetch sockets for joined room:', err);
    }

    eventBus.publish({
      type: "room.joined",
      stream: "rooms",
      actor: { id: user.id, username: user.username, role: user.role, socketId: socket.id, ip: socket.handshake.address },
      target: { id: canonicalRoomId, type: "room", roomId: canonicalRoomId },
      payload: { roomId: canonicalRoomId, username: user.username },
      metadata: { roomId: canonicalRoomId, source: "socket.roomHandlers", shardKey: canonicalRoomId },
    }).catch(err => console.error("EventBus publish failed (room.joined):", err));

    const members = await getRoomMembers(canonicalRoomId);
    console.log(`[TRANSITION_TRACE] getRoomMembers for newRoom=${canonicalRoomId} returned ${members.length} members for callback memberIds=${JSON.stringify(members.map(m=>({id:m.id, username:m.username, socketId:m.socketId})))}`);
    
    // Batch fetch member levels from user_profiles
    const memberIds = members.map(m => String(m.id)).filter(Boolean);
    const memberProfilesMap = new Map<string, { level: number; exp: number }>();
    if (memberIds.length > 0) {
      try {
        const profRes = await dbPool.query(
          `SELECT user_id, level, exp FROM user_profiles WHERE user_id = ANY($1::text[])`,
          [memberIds]
        );
        for (const row of profRes.rows) {
          memberProfilesMap.set(String(row.user_id), row);
        }
      } catch (_) {}
    }

    callback?.({
      success: true,
      roomId: canonicalRoomId,
      messages: [],
      members: members.map((m) => {
        const p = memberProfilesMap.get(String(m.id));
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
          idreg: m.idreg || "",
        };
      }),
      memberCount: members.length,
    });

    if (!isReconnect) {
      console.log(`[TRANSITION_TRACE] emitting user_joined to newRoom=${canonicalRoomId} memberCount=${members.length} excludeSocket=${socket.id}`);
      await publishSocketEvent(canonicalRoomId, "user_joined", {
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
          statusFontColor: socket.data.user.statusFontColor || "",
          level: Number((user as any).level) || 1,
          exp: Number((user as any).exp) || 0,
          roomRole: (user as any).roomRole || (user.role === "admin" || user.role === "owner" ? "super_admin" : (user.role === "moderator" ? "moderator" : "member")),
          idreg: String((user as any).idreg || ""),
        },
        memberCount: members.length,
      }, socket.id);

      // Broadcast live counter update globally for the joined room
      console.log(`[TRANSITION_TRACE] emitting room_count_update for newRoom=${canonicalRoomId} memberCount=${members.length}`);
      await emitRoomCount(canonicalRoomId);

      console.log(`[TRANSITION_TRACE] === END TRANSITION user=${user.username} socket=${socket.id} from=${previousRoomId} to=${canonicalRoomId} emittedMemberCount=${members.length} ===`);

      // Broadcast transition/entrance system message to the new room
      if (previousRoomId && previousRoomId !== canonicalRoomId) {
        await publishSocketEvent(canonicalRoomId, "system_message", {
          text: `دخل الغرفة (انتقل من: ${prevRoomName})`,
          roomId: canonicalRoomId,
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
        await publishSocketEvent(canonicalRoomId, "system_message", {
          text: `دخل الغرفة`,
          roomId: canonicalRoomId,
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

      const requiredPermissions = getMessagePermissionRequirements({
        channel: "room",
        text,
        mediaType,
        hasMedia: Boolean(mediaUrl || data?.mediaUrls?.length),
        hasEffects: Boolean(data?.sticker || data?.animatedFaces?.length),
      });
      if (!(await hasChatFeatureAccess(user, requiredPermissions))) {
        callback?.({ success: false, message: "لا تملك صلاحية استخدام إحدى ميزات الرسالة" });
        return;
      }

      // فحص الإسكات - المستخدم المكتوم لا يمكنه إرسال رسائل
      if ((socket.data.user as any).muted) {
        callback?.({ success: false, muted: true, message: "تم منعك من الحديث في الدردشة" });
        return;
      }

      // فحص الكتم الغرفي (منفصل عن العام): يمنع فقط داخل الغرفة المكتوم عليها
      const roomMutedRoomsFlag = (socket.data.user as any).roomMutedRooms;
      if (roomMutedRoomsFlag instanceof Set && (roomMutedRoomsFlag.has(roomId) || roomMutedRoomsFlag.has(`room:${roomId}`))) {
        callback?.({ success: false, muted: true, roomMuted: true, message: "تم منعك من الحديث في هذه الغرفة" });
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
        user: (socket.data.user as any)?.displayName || (user as any)?.displayName || user.username,
        userId: String(user.id || ""),
        role: user.role,
        countryCode: user.countryCode,
        avatar: user.avatar,
        avatarFrameUrl: user.avatarFrameUrl,
        giftIconUrl: user.giftIconUrl,
        messageBubbleStyle: user.messageBubbleStyle,
        nameColor: socket.data.user.nameColor || "",
        statusFontColor: socket.data.user.statusFontColor || "",
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

      if (!(await hasChatFeatureAccess(user, ["room_reactions.use"]))) {
        return callback?.({ success: false, error: "لا تملك صلاحية التفاعل مع رسائل الغرف" });
      }

      // فحص الإسكات
      if ((socket.data.user as any).muted) {
        return callback?.({ success: false, muted: true, error: "تم منعك من الحديث في الدردشة" });
      }

      // فحص الكتم الغرفي (منفصل عن العام)
      const reactRoomMutedFlag = (socket.data.user as any).roomMutedRooms;
      if (reactRoomMutedFlag instanceof Set && (reactRoomMutedFlag.has(roomId) || reactRoomMutedFlag.has(`room:${roomId}`))) {
        return callback?.({ success: false, muted: true, roomMuted: true, error: "تم منعك من الحديث في هذه الغرفة" });
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
    if ((socket.data.user as any).muted) return;
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
      console.log(`[KICK_TRACE_LEAVE] runLeave triggered (new server) socketId=${socket.id} roomId=${roomId} kicked=${!!(socket.data as any).kicked}`);
      socket.leave(`room:${roomId}`);
      await leaveRoom(socket.id, roomId);
      await disconnectLiveKitParticipant(roomId);
      await vacateUserFromAllSeats(user.id, io, user.username);
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

      // إذا كان العضو مطروداً لا نرسل رسالة "غادر الغرفة" لتجنب الازدواج
      const isKicked = !!(socket.data as any).kicked;
      if (isKicked) {
        (socket.data as any).kicked = false;
      } else {
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
      }

      // Broadcast live counter update globally
      await emitRoomCount(roomId);
    };

    const timeout = setTimeout(() => {
      runLeave().catch(err => console.error("Delayed leave failed:", err));
    }, 250);

    pendingLeaves.set(socket.id, { roomId, timeout });
  });

  
  // ─── جلب بروفايل الغرفة التفصيلي (Room Profile) ───────────────────────────
  socket.on("room:get_profile", async (data: { roomId: string }, callback?: (res: any) => void) => {
    return handleGetRoomProfile(io, socket, data, callback);
  });

  // ─── تعيين رتبة أو صلاحية لعضو داخل الغرفة ────────────────────────────────
  socket.on("room:set_role", async (data: { roomId: string; targetUserId: string; role: any; customTitle?: string; badgeId?: string }, callback?: (res: any) => void) => {
    return handleSetRoomRole(io, socket, data, callback);
  });

  socket.on("disconnect", async () => {
    if (pendingLeaves.has(socket.id)) {
      clearTimeout(pendingLeaves.get(socket.id)!.timeout);
      pendingLeaves.delete(socket.id);
    }

    if (socket.data?.loggedOut) {
      return;
    }

    const roomId = socket.data?.user?.roomId || "";
    // مفتاح مؤقت قطع الاتصال لكل "جلسة" (socketId) وليس للمستخدم، حتى لا يُلغى مؤقّت
    // جلسة قديمة عند انقطاع جلسة ثانية لنفس المستخدم ويبقى سجلها معلقاً للأبد
    const socketKey = socket.id;

    const ownPending = pendingDisconnects.get(socketKey);
    if (ownPending) {
      if (ownPending.timeout) clearTimeout(ownPending.timeout);
      if (ownPending.presenceTimeout) clearTimeout(ownPending.presenceTimeout);
      pendingDisconnects.delete(socketKey);
    }

    const runDisconnect = async () => {
      pendingDisconnects.delete(socketKey);
      console.log(`[KICK_TRACE_DISCONNECT] runDisconnect triggered (new server) socketId=${socket.id} roomId=${roomId} kicked=${!!(socket.data as any).kicked}`);

      if (roomId) {
        await disconnectLiveKitParticipant(roomId);
        await vacateUserFromAllSeats(user.id, io, user.username);

        // إذا كان العضو مطروداً لا نرسل رسالة "غادر الغرفة"
        const isKicked = !!(socket.data as any).kicked;
        if (isKicked) {
          (socket.data as any).kicked = false;
        } else {
          eventBus.publish({
            type: "room.left",
            stream: "rooms",
            actor: { id: user.id, username: user.username, role: user.role, socketId: socket.id, ip: socket.handshake.address },
            target: { id: roomId, type: "room", roomId },
            payload: { roomId, username: user.username, disconnected: true },
            metadata: { roomId, source: "socket.roomHandlers.disconnect", shardKey: roomId },
          }).catch(err => console.error("EventBus publish failed (room.left on disconnect):", err));
        }

        const memberCount = await getRoomMemberCount(roomId);
        await publishSocketEvent(roomId, "user_left", {
          socketId: socket.id,
          username: user.username,
          roomId,
          memberCount: Math.max(0, memberCount),
        });

        // Broadcast leave system message on disconnect
        if (!isKicked) {
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
        }
      }

      // تنظيف الحضور لجميع الحالات (سواء كان في غرفة أو لم يكن) (Fix #1)
      try {
        const removedUser = await removeConnectedUser(socket.id);
        const totalCount = await getTotalOnlineCount();
        io.emit("online_count", { count: totalCount });
        io.emit("user_disconnected", {
          socketId: socket.id,
          userId: user.id,
          username: user.username,
          role: user.role,
          count: totalCount,
        });
        const finalRoomId = roomId || removedUser?.roomId;
        if (finalRoomId) {
          await emitRoomCount(finalRoomId);
        }
      } catch (err) {
        console.error("[disconnect] presence cleanup failed:", err);
      }
    };

    const timeout = setTimeout(() => {
      runDisconnect().catch(err => console.error("Delayed disconnect failed:", err));
    }, 3000);

    pendingDisconnects.set(socketKey, {
      roomId,
      timeout,
      presenceTimeout: timeout,
      socketId: socket.id,
      userData: { ...user }
    });
  });
}

export async function handleGetRoomProfile(
  io: Server,
  socket: Socket,
  data: { roomId: string },
  callback?: (res: any) => void
): Promise<void> {
  const user = socket.data?.user || {};
  try {
    const rawRoomId = String(data?.roomId || "").trim();
    if (!rawRoomId) {
      callback?.({ success: false, message: "معرف الغرفة مطلوب" });
      return;
    }
    const { resolveRoomIdVariants, normalizeRoomIdValue } = await import("./roomAccess");
    const normalized = normalizeRoomIdValue(rawRoomId);
    const variants = await resolveRoomIdVariants(rawRoomId);
    const candidates = Array.from(new Set([rawRoomId, normalized, ...variants].filter(Boolean)));
    console.log("[room:get_profile] incoming:", { rawRoomId, candidates, user: user?.username });

    const roomRes = await dbPool.query(
      `SELECT r.id, r.slug, r.name, r.topic, r.about, r.description, r.cover_url, r.avatar_url, r.pic,
              r.level, r.exp, r.pinned_announcement, r.owner, r.owner_id, r.created_at,
              r.verified, r.rmli,
              rb.id as badge_id, rb.name as badge_name, rb.icon as badge_icon, rb.bg as badge_bg,
              rb.icon_url as badge_icon_url, rb.bg_type as badge_bg_type
       FROM rooms r
       LEFT JOIN room_badges rb ON rb.id = r.badge_id
       WHERE CAST(r.id AS text) = ANY($1::text[]) 
          OR r.slug = ANY($1::text[]) 
          OR CAST(r.idroom AS text) = ANY($1::text[])
       LIMIT 1`,
      [candidates]
    );
    if (roomRes.rows.length === 0) {
      callback?.({ success: false, message: "الغرفة غير موجودة" });
      return;
    }
    const r = roomRes.rows[0];
    const canonicalRoomId = String(r.id || rawRoomId);
    const roomSlug = String(r.slug || "");

    // 1. تحديد بيانات مالك الغرفة الحقيقي بدقة (سواء مسجل بالمعرف أو برقم العضوية أو بالاسم)
    const cleanOwnerRef = String(r.owner || "").replace(/^#+/, "").trim();
    let ownerUser: any = null;
    if (r.owner_id) {
      try {
        const oRes = await dbPool.query(
          `SELECT id, idreg, username, role, avatar FROM users WHERE id::text = $1 LIMIT 1`,
          [r.owner_id]
        );
        if (oRes.rows.length > 0) ownerUser = oRes.rows[0];
      } catch (_) {}
    }
    if (!ownerUser && cleanOwnerRef) {
      try {
        const oRes = await dbPool.query(
          `SELECT id, idreg, username, role, avatar FROM users 
           WHERE idreg::text = $1 OR lower(username) = lower($1) OR id::text = $1 LIMIT 1`,
          [cleanOwnerRef]
        );
        if (oRes.rows.length > 0) ownerUser = oRes.rows[0];
      } catch (_) {}
    }
    const resolvedOwnerName = ownerUser ? ownerUser.username : (cleanOwnerRef || "إدارة الموقع");
    const resolvedOwnerId = ownerUser ? String(ownerUser.id) : (r.owner_id || "");
    const resolvedOwnerIdreg = ownerUser ? String(ownerUser.idreg) : (cleanOwnerRef || "");

    // فحص الإعجابات
    let likesCount = Number(r.rmli) || 0;
    let isLiked = false;
    try {
      const likeRes = await dbPool.query(
        `SELECT 1 FROM room_likes WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
        [canonicalRoomId, String(user.id || "")]
      );
      isLiked = likeRes.rows.length > 0;
    } catch (_) {}

    // 2. جلب جميع الأعضاء المتواجدين حالياً في الغرفة عبر كافة معرفاتها (UUID, Slug, rawRoomId)
    const lookupRoomIds = Array.from(new Set([canonicalRoomId, roomSlug, rawRoomId].filter(Boolean)));
    const membersMap = new Map<string, OnlineUser>();
    for (const rid of lookupRoomIds) {
      try {
        const list = await getRoomMembers(rid);
        for (const m of list) {
          const key = String(m.id || m.username).toLowerCase();
          if (!membersMap.has(key)) {
            membersMap.set(key, m);
          }
        }
      } catch (_) {}
    }
    const onlineUsers = Array.from(membersMap.values());
    const memberCount = Math.max(onlineUsers.length, await getRoomMemberCount(canonicalRoomId));

    // 3. جلب الرتب والصلاحيات المعينة داخل الغرفة من جدول room_members
    const assignedRolesMap = new Map<string, any>();
    try {
      const rolesRes = await dbPool.query(
        `SELECT user_id, role, power, custom_title, badge_id FROM room_members 
         WHERE room_id = $1 OR room_id::text = $2`,
        [r.id, canonicalRoomId]
      );
      for (const row of rolesRes.rows) {
        assignedRolesMap.set(String(row.user_id), row);
      }
    } catch (_) {}

    // 4. جلب المستويات الحقيقية والخبرة وأرقام العضوية للأعضاء من قاعدة البيانات
    const userIds = onlineUsers.map((u) => String(u.id)).filter(Boolean);
    const userProfilesMap = new Map<string, { level: number; exp: number; idreg: string }>();
    const userAccountsMap = new Map<string, { idreg: string; role: string; username: string }>();

    if (userIds.length > 0) {
      try {
        const profRes = await dbPool.query(
          `SELECT user_id, idreg, level, exp FROM user_profiles WHERE user_id = ANY($1::text[])`,
          [userIds]
        );
        for (const row of profRes.rows) {
          userProfilesMap.set(String(row.user_id), row);
        }
      } catch (_) {}

      try {
        const accRes = await dbPool.query(
          `SELECT id, idreg, role, username FROM users WHERE id::text = ANY($1::text[]) OR lower(username) = ANY($2::text[])`,
          [userIds, onlineUsers.map((u) => String(u.username).toLowerCase())]
        );
        for (const row of accRes.rows) {
          userAccountsMap.set(String(row.id), row);
          if (row.idreg) userAccountsMap.set(String(row.idreg), row);
          if (row.username) userAccountsMap.set(String(row.username).toLowerCase(), row);
        }
      } catch (_) {}
    }

    // 5. بناء كائنات الأعضاء مع الرتبة والقوة والمستوى الحقيقي
    const members = onlineUsers.map((m) => {
      const userIdStr = String(m.id);
      const assigned = assignedRolesMap.get(userIdStr);
      const userProf = userProfilesMap.get(userIdStr);
      const userAcc = userAccountsMap.get(userIdStr) || userAccountsMap.get(String(m.username).toLowerCase());
      const idreg = String(userAcc?.idreg || userProf?.idreg || m.idreg || "").replace(/^#+/, "");

      // التحقق الدقيق من مالك الغرفة
      const isOwner = Boolean(
        (resolvedOwnerId && userIdStr === resolvedOwnerId) ||
        (resolvedOwnerIdreg && idreg === resolvedOwnerIdreg) ||
        (resolvedOwnerName && m.username.toLowerCase() === resolvedOwnerName.toLowerCase())
      );

      let roomRole = "member";
      let roomPower = 1000;
      let customTitle = assigned?.custom_title || "";

      if (isOwner) {
        roomRole = "owner";
        roomPower = 100000;
      } else if (assigned?.role) {
        roomRole = assigned.role;
        roomPower = Number(assigned.power) || (
          roomRole === "co_owner" ? 80000 :
          roomRole === "super_admin" ? 50000 :
          roomRole === "moderator" ? 30000 :
          roomRole === "vip" ? 10000 : 1000
        );
      } else if (m.role === "admin" || m.role === "owner" || userAcc?.role === "admin" || userAcc?.role === "owner") {
        roomRole = "super_admin";
        roomPower = 50000;
      } else if (m.role === "moderator" || userAcc?.role === "moderator") {
        roomRole = "moderator";
        roomPower = 30000;
      } else if (m.role === "guest") {
        roomRole = "guest";
        roomPower = 100;
      } else {
        roomRole = "member";
        roomPower = 1000;
      }

      const memberLevel = Number(userProf?.level) || Number((m as any).level) || 1;
      const memberExp = Number(userProf?.exp) || Number((m as any).exp) || 0;

      return {
        id: userIdStr,
        idreg,
        username: m.username,
        avatar: m.avatar || "/pic.png",
        level: memberLevel,
        exp: memberExp,
        role: m.role,
        roomRole,
        roomPower,
        customTitle,
        status: m.status || "online",
      };
    });

    // ترتيب الأعضاء تنازلياً بحسب القوة أولاً، ثم المستوى، ثم الخبرة
    members.sort((a, b) => {
      if (b.roomPower !== a.roomPower) return b.roomPower - a.roomPower;
      if (b.level !== a.level) return b.level - a.level;
      return b.exp - a.exp;
    });

    // 6. تكوين قائمة الشارات الحقيقية الممنوحة للغرفة (Badges) بدون أي شارات وهمية
    const badges: any[] = [];

    // أ) شارة التوثيق الرسمية
    if (Boolean(r.verified)) {
      badges.push({
        id: "verified",
        name: "غرفة موثقة",
        description: "غرفة معتمدة وموثقة رسمياً بالعلامة الخضراء",
        icon: "check",
        type: "verified",
        color: "bg-emerald-500",
      });
    }

    // ب) شارة مخصصة ممنوحة للغرفة من جدول room_badges
    if (r.badge_id && r.badge_name) {
      badges.push({
        id: String(r.badge_id),
        name: r.badge_name,
        description: "شارة إدارية شرفية ممنوحة للغرفة",
        icon: r.badge_icon || r.badge_icon_url || "award",
        bg: r.badge_bg || "",
        bgType: r.badge_bg_type || "static",
        type: "custom",
        color: r.badge_bg ? "" : "bg-purple-600",
      });
    }

    // ج) شارة مستوى الغرفة المتقدم
    const roomLvl = Number(r.level) || 1;
    if (roomLvl >= 2) {
      badges.push({
        id: "room_level",
        name: `المستوى ${roomLvl}`,
        description: `غرفة متميزة في المستوى ${roomLvl}`,
        icon: "level",
        level: roomLvl,
        type: "level",
        color: roomLvl >= 25 ? "bg-amber-500" : "bg-blue-600",
      });
    }

    // د) شارة التفاعل والنشاط
    if (members.length >= 5 && likesCount >= 10) {
      badges.push({
        id: "hot_room",
        name: "غرفة متفاعلة",
        description: "تفاعل مستمر وحضور مميز",
        icon: "fire",
        type: "active",
        color: "bg-orange-500",
      });
    }

    callback?.({
      success: true,
      profile: {
        id: canonicalRoomId,
        slug: roomSlug,
        name: r.name || r.topic,
        description: r.description || r.about || "",
        coverUrl: r.cover_url || "",
        avatarUrl: r.avatar_url || r.pic || "",
        level: roomLvl,
        exp: Number(r.exp) || 0,
        pinnedAnnouncement: r.pinned_announcement || "",
        owner: resolvedOwnerName,
        ownerId: resolvedOwnerId,
        ownerIdreg: resolvedOwnerIdreg,
        createdAt: r.created_at,
        memberCount: members.length || memberCount,
        likesCount,
        isLiked,
        badges,
        members,
      }
    });
  } catch (err: any) {
    console.error("room:get_profile error:", err);
    callback?.({ success: false, message: "تعذر جلب ملف الغرفة" });
  }
}

export async function handleSetRoomRole(
  io: Server,
  socket: Socket,
  data: { roomId: string; targetUserId: string; role: any; customTitle?: string; badgeId?: string },
  callback?: (res: any) => void
): Promise<void> {
  const user = socket.data?.user || {};
  try {
    const result = await setRoomMemberRole({
      roomId: data.roomId,
      actorUserId: String(user.id || ""),
      targetUserId: data.targetUserId,
      newRole: data.role,
      customTitle: data.customTitle,
      badgeId: data.badgeId,
    });
    if (result.success) {
      io.to(`room:${data.roomId}`).emit("room:role_changed", {
        roomId: data.roomId,
        userId: data.targetUserId,
        role: data.role,
        customTitle: data.customTitle,
      });
    }
    callback?.(result);
  } catch (err: any) {
    callback?.({ success: false, message: err?.message || "فشل تعيين الرتبة" });
  }
}
