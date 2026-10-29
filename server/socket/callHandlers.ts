/**
 * WebRTC 1-on-1 Private Voice Call Signaling Handlers
 * يدير إشارات الاتصال الصوتي المباشر بين مستخدمين في الدردشة الخاصة
 */
import type { Server, Socket } from "socket.io";
import { SOCKET_CHANNELS } from "./SocketChannels";

interface ActiveCallSession {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string;
  receiverId: string;
  receiverName?: string;
  receiverAvatar?: string;
  status: "ringing" | "connected";
  startedAt?: number;
}

// تخزين المكالمات النشطة في الذاكرة
const activeCalls = new Map<string, ActiveCallSession>(); // callId -> session
const userCurrentCall = new Map<string, string>(); // userId -> callId

export function isUserInCall(userId: string): boolean {
  const callId = userCurrentCall.get(String(userId));
  if (!callId) return false;
  const session = activeCalls.get(callId);
  if (!session) {
    userCurrentCall.delete(String(userId));
    return false;
  }
  // تنظيف المكالمات المعلقة إذا مضى عليها أكثر من 60 ثانية بدون اتصال
  if (session.status === "ringing" && session.startedAt && Date.now() - session.startedAt > 60000) {
    activeCalls.delete(callId);
    userCurrentCall.delete(String(userId));
    return false;
  }
  return true;
}

// دالة مساعدة لضمان وصول الحدث للطرف الآخر عبر كافة الطرق الممكنة (Rooms + Direct Sockets)
function emitToTargetUser(io: Server, toUserId: string, event: string, data: any, excludeSocketId?: string) {
  const targetIdStr = String(toUserId);
  const socialRoom = SOCKET_CHANNELS.social(targetIdStr);
  const userRoom = `user:${targetIdStr}`;

  const senderSocket = excludeSocketId ? io.sockets.sockets.get(excludeSocketId) : null;
  if (senderSocket) {
    senderSocket.to(socialRoom).emit(event, data);
    senderSocket.to(userRoom).emit(event, data);
  } else {
    io.to(socialRoom).emit(event, data);
    io.to(userRoom).emit(event, data);
  }

  // إرسال مباشر لكافة sockets المتصلة بهذا العضو كطبقة حماية إضافية (مع استبعاد السوكيت المرسل)
  let directCount = 0;
  for (const [sId, s] of io.sockets.sockets) {
    if (excludeSocketId && sId === excludeSocketId) continue;
    const socketUserId = String(s.data?.user?.id || s.handshake.auth?.userId || "");
    if (socketUserId && socketUserId === targetIdStr) {
      s.emit(event, data);
      directCount++;
    }
  }
  console.log(`[SERVER_CALL] emitToTargetUser event=${event} to=${targetIdStr} (rooms: ${socialRoom}, ${userRoom}, directSockets: ${directCount}, excludedSender=${excludeSocketId || 'none'})`);
}

export function registerCallHandlers(io: Server, socket: Socket) {
  const getUserId = () => String(socket.data?.user?.id || socket.handshake.auth?.userId || "");

  // انضمام فوري لغرف المستخدم الخاصة بالإشارات
  socket.on("join_user", (data: { userId: string }) => {
    const uId = String(data?.userId || getUserId());
    if (uId) {
      socket.join(`user:${uId}`);
      socket.join(SOCKET_CHANNELS.social(uId));
      console.log(`[SERVER_CALL] socket ${socket.id} explicitly joined call rooms for userId=${uId}`);
    }
  });

  // 1. بدء مكالمة (call:offer)
  socket.on("call:offer", (payload: {
    toUserId: string;
    sdp: any;
    mode?: "voice" | "video";
    callerInfo?: { name: string; avatar: string; rank?: string };
  }, callback?: (res: any) => void) => {
    try {
      const fromUserId = getUserId();
      const { toUserId, sdp, callerInfo, mode = "voice" } = payload;
      console.log(`[SERVER_CALL] call:offer from=${fromUserId} to=${toUserId} mode=${mode}`);

      if (!fromUserId || !toUserId) {
        console.warn("[SERVER_CALL] call:offer rejected: missing user info", { fromUserId, toUserId });
        return callback?.({ success: false, error: "بيانات المستخدم غير مكتملة" });
      }

      if (fromUserId === String(toUserId)) {
        return callback?.({ success: false, error: "لا يمكنك الاتصال بنفسك" });
      }

      // إذا كان للمتصل مكالمة رنين سابقة معلقة، نظفها تلقائياً
      if (isUserInCall(fromUserId)) {
        const oldCallId = userCurrentCall.get(fromUserId);
        const oldSession = oldCallId ? activeCalls.get(oldCallId) : null;
        if (oldSession && oldSession.status === "ringing") {
          activeCalls.delete(oldCallId!);
          userCurrentCall.delete(fromUserId);
          userCurrentCall.delete(oldSession.receiverId);
        } else {
          return callback?.({ success: false, error: "أنت تجري مكالمة نشطة بالفعل" });
        }
      }

      // التحقق مما إذا كان المستقبل مشغولاً بمكالمة أخرى
      if (isUserInCall(String(toUserId))) {
        const oldCallId = userCurrentCall.get(String(toUserId));
        const oldSession = oldCallId ? activeCalls.get(oldCallId) : null;
        if (oldSession && oldSession.status === "ringing") {
          activeCalls.delete(oldCallId!);
          userCurrentCall.delete(String(toUserId));
          userCurrentCall.delete(oldSession.callerId);
        } else {
          socket.emit("call:busy", { userId: toUserId, reason: "المستخدم في مكالمة أخرى" });
          return callback?.({ success: false, busy: true, error: "المستخدم مشغول حالياً" });
        }
      }

      const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const callerName = callerInfo?.name || socket.data?.user?.username || "مستخدم";
      const callerAvatar = callerInfo?.avatar || socket.data?.user?.avatar || "/pic.png";

      const session: ActiveCallSession = {
        callId,
        callerId: fromUserId,
        callerName,
        callerAvatar,
        receiverId: String(toUserId),
        status: "ringing",
        startedAt: Date.now(),
      };

      activeCalls.set(callId, session);
      userCurrentCall.set(fromUserId, callId);
      userCurrentCall.set(String(toUserId), callId);

      // إرسال الإشعار والعرض للطرف الآخر
      const offerData = {
        callId,
        fromUserId,
        mode,
        caller: {
          id: fromUserId,
          name: callerName,
          avatar: callerAvatar,
          rank: callerInfo?.rank || "عضو",
          verified: true,
        },
        sdp,
      };

      emitToTargetUser(io, String(toUserId), "call:incoming", offerData, socket.id);

      console.log(`[SERVER_CALL] call:offer successfully registered. callId=${callId}`);
      callback?.({ success: true, callId });
    } catch (err: any) {
      console.error("[SERVER_CALL] call:offer Error:", err);
      callback?.({ success: false, error: err.message || "حدث خطأ أثناء الاتصال" });
    }
  });

  // 2. قبول المكالمة (call:answer)
  socket.on("call:answer", (payload: {
    callId: string;
    toUserId: string;
    sdp: any;
  }, callback?: (res: any) => void) => {
    try {
      const fromUserId = getUserId();
      const { callId, toUserId, sdp } = payload;
      console.log(`[SERVER_CALL] call:answer from=${fromUserId} to=${toUserId} callId=${callId}`);
      const session = activeCalls.get(callId);

      if (!session) {
        return callback?.({ success: false, error: "المكالمة لم تعد متاحة" });
      }

      session.status = "connected";
      session.startedAt = Date.now();

      // إرسال الـ Answer للمتصل الأصلي
      const answerData = {
        callId,
        fromUserId,
        sdp,
      };

      emitToTargetUser(io, String(toUserId), "call:answered", answerData, socket.id);
      callback?.({ success: true });
    } catch (err: any) {
      console.error("[SERVER_CALL] call:answer Error:", err);
      callback?.({ success: false, error: err.message });
    }
  });

  // 3. تبادل مرشحي الاتصال (call:ice_candidate)
  socket.on("call:ice_candidate", (payload: {
    callId: string;
    toUserId: string;
    candidate: any;
  }) => {
    try {
      const fromUserId = getUserId();
      const { callId, toUserId, candidate } = payload;

      if (!candidate || !toUserId) return;

      const candidateData = {
        callId,
        fromUserId,
        candidate,
      };

      emitToTargetUser(io, String(toUserId), "call:ice_candidate", candidateData, socket.id);
    } catch (err) {
      console.error("[SERVER_CALL] call:ice_candidate Error:", err);
    }
  });

  // تبديل حالة الكاميرا للمكالمة النشطة
  socket.on("call:camera_toggle", (payload: {
    callId: string;
    toUserId: string;
    enabled: boolean;
  }) => {
    try {
      const fromUserId = getUserId();
      emitToTargetUser(io, String(payload.toUserId), "call:camera_toggled", {
        callId: payload.callId,
        fromUserId,
        enabled: payload.enabled,
      }, socket.id);
    } catch (err) {
      console.error("[SERVER_CALL] call:camera_toggle Error:", err);
    }
  });

  // 4. رفض المكالمة (call:reject)
  socket.on("call:reject", (payload: {
    callId: string;
    toUserId: string;
    reason?: string;
  }) => {
    try {
      const fromUserId = getUserId();
      const { callId, toUserId, reason } = payload;
      console.log(`[SERVER_CALL] call:reject from=${fromUserId} to=${toUserId} callId=${callId}`);

      if (callId) {
        activeCalls.delete(callId);
      }
      userCurrentCall.delete(fromUserId);
      userCurrentCall.delete(String(toUserId));

      const rejectData = {
        callId,
        fromUserId,
        reason: reason || "تم رفض المكالمة",
      };

      emitToTargetUser(io, String(toUserId), "call:rejected", rejectData, socket.id);
    } catch (err) {
      console.error("[SERVER_CALL] call:reject Error:", err);
    }
  });

  // 5. إنهاء المكالمة (call:end)
  socket.on("call:end", (payload: {
    callId: string;
    toUserId: string;
    durationSeconds?: number;
  }) => {
    try {
      const fromUserId = getUserId();
      const { callId, toUserId, durationSeconds } = payload;
      console.log(`[SERVER_CALL] call:end from=${fromUserId} to=${toUserId} callId=${callId}`);

      if (callId) {
        activeCalls.delete(callId);
      }
      userCurrentCall.delete(fromUserId);
      userCurrentCall.delete(String(toUserId));

      const endData = {
        callId,
        fromUserId,
        durationSeconds: durationSeconds || 0,
      };

      emitToTargetUser(io, String(toUserId), "call:ended", endData, socket.id);
    } catch (err) {
      console.error("[SERVER_CALL] call:end Error:", err);
    }
  });

  // 6. التعامل مع انقطاع اتصال السوكيت (Disconnect)
  socket.on("disconnect", () => {
    const fromUserId = getUserId();
    if (!fromUserId) return;

    const callId = userCurrentCall.get(fromUserId);
    if (callId) {
      const session = activeCalls.get(callId);
      if (session) {
        const otherUserId = session.callerId === fromUserId ? session.receiverId : session.callerId;
        userCurrentCall.delete(otherUserId);
        activeCalls.delete(callId);

        emitToTargetUser(io, otherUserId, "call:ended", {
          callId,
          fromUserId,
          reason: "انقطع الاتصال",
        }, socket.id);
      }
      userCurrentCall.delete(fromUserId);
    }
  });
}
