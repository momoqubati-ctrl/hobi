import { addUserExp } from "../services/userLevelService";
import { Server, Socket } from "socket.io";
import { resolveRoomId } from "./roomAccess";
import { publishSocketEvent, publishUserEvent } from "./SocketBroker";
import { dbPool } from "../db";
import { voiceStageStore, type RoomVoiceStage, type VoiceSeat } from "../services/voiceStageStore";
import {
  disconnectConfiguredLiveKitParticipant,
  ensureConfiguredLiveKitRoom,
  reconcileConfiguredLiveKitPublishPermissions,
  syncConfiguredLiveKitPublishPermission,
} from "../services/livekitVoicePermissions";
import { canPublishFromSeat } from "../services/voiceTokenAccess";
import { hasChatFeatureAccess } from "../services/chatAuthorization";
import { createVoiceProviderStore } from "../services/voiceProviderStore";

/**
 * الحصول على حالة الاستيج لغرفة معينة أو تهيئتها
 */
export async function getOrCreateRoomStage(canonicalRoomId: string): Promise<RoomVoiceStage> {
  let stage = await voiceStageStore.getStage(canonicalRoomId);
  if (!stage) {
    let maxSeats = 5; // الافتراضي للغرفة العادية 5 مقاعد
    let isVoiceChannel = false;

    try {
      const res = await dbPool.query(
        `SELECT settings, slug FROM rooms WHERE CAST(id AS text) = $1 LIMIT 1`,
        [canonicalRoomId]
      );
      const row = res.rows[0];
      if (row) {
        const settings = row.settings || {};
        if (settings.type === "voice_channel" || settings.isVoiceChannel || row.slug?.startsWith("voice-")) {
          isVoiceChannel = true;
          maxSeats = Math.min(Math.max(Number(settings.maxSeats) || 12, 10), 15); // بين 10 و 15 مقعد
        } else {
          maxSeats = 5; // الغرف العادية 5 مقاعد كحد أقصى
        }
      }
    } catch (e) {
      console.warn("[VoiceStage] Could not read room settings for:", canonicalRoomId, e);
    }

    stage = {
      roomId: canonicalRoomId,
      maxSeats,
      isVoiceChannel,
      seats: Array.from({ length: maxSeats }, () => null),
    };
    stage = await voiceStageStore.ensureStage(stage);
  }
  return stage;
}

/**
 * تفريغ مقعد المستخدم عند الخروج أو تغيير الغرفة أو قطع الاتصال
 */
export async function vacateUserFromAllSeats(userId?: string | number, _io?: Server, _username?: string): Promise<void> {
  const targetIdStr = userId != null ? String(userId).trim() : "";
  if (!targetIdStr) return;

  const result = await voiceStageStore.leaveSeat(targetIdStr);
  if (!result) return;

  let permissionSyncError: unknown;
  try {
    await syncConfiguredLiveKitPublishPermission(result.roomId, targetIdStr, false);
  } catch (error) {
    permissionSyncError = error;
    console.error("[VoiceStage] Failed to revoke LiveKit publishing after seat removal:", error);
  }
  await publishSocketEvent(result.roomId, "voice_stage:seats_updated", result.stage);
  if (permissionSyncError) throw permissionSyncError;
}

/**
 * تسجيل مستمعي السوكيت للتحكم في المنصة الصوتية
 */

let voiceExpTickerStarted = false;
function ensureVoiceExpTicker(io: Server) {
  if (voiceExpTickerStarted) return;
  voiceExpTickerStarted = true;

  setInterval(async () => {
    try {
      const activeSeats = await voiceStageStore.listActiveSeats();
      const activePublisherKeys = new Set(
        activeSeats
        .filter(({ seat }) => canPublishFromSeat(seat, seat.role))
        .map(({ roomId, seat }) => `${roomId}\u0000${seat.userId}`),
      );
      if (await voiceStageStore.claimPermissionReconciliationTick()) {
        await reconcileConfiguredLiveKitPublishPermissions(activePublisherKeys);
      }
      for (const { roomId, seat } of activeSeats) {
        if (!seat.isMuted && await voiceStageStore.claimExperienceTick(seat.userId)) {
          await addUserExp(seat.userId, 10, {
            roomId,
            username: seat.username,
            io,
            source: "voice_stage",
          });
        }
      }
    } catch (err) {
      console.error("[VoiceStage] Maintenance ticker error:", err);
    }
  }, 60000);
}

export function registerVoiceStageHandlers(io: Server, socket: Socket) {
  ensureVoiceExpTicker(io);
  const getUser = () => socket.data?.user || { id: socket.id, username: "زائر", role: "guest" };

  /**
   * جلب مقاعد الغرفة الحالية
   */
  socket.on("voice_stage:get_seats", async (data: { roomId: string }, callback?: (res: any) => void) => {
    try {
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      if (!canonicalRoomId) {
        callback?.({ success: false, message: "معرف الغرفة غير صالح" });
        return;
      }
      const stage = await getOrCreateRoomStage(canonicalRoomId);
      const { provider } = await createVoiceProviderStore().getRequestedSelection();
      callback?.({
        success: true,
        roomId: canonicalRoomId,
        maxSeats: stage.maxSeats,
        isVoiceChannel: stage.isVoiceChannel,
        provider,
        seats: stage.seats,
      });
    } catch (err: any) {
      callback?.({ success: false, message: err?.message });
    }
  });

  socket.on("voice_stage:heartbeat", async (data: { roomId: string }, callback?: (res: any) => void) => {
    try {
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      if (!canonicalRoomId || !socket.rooms.has(`room:${canonicalRoomId}`)) {
        callback?.({ success: false });
        return;
      }
      const refreshed = await voiceStageStore.heartbeat(canonicalRoomId, getUser().id);
      if (!refreshed) {
        await syncConfiguredLiveKitPublishPermission(canonicalRoomId, String(getUser().id), false);
      }
      callback?.({ success: refreshed });
    } catch (err) {
      console.error("[VoiceStage] Seat heartbeat failed:", err);
      callback?.({ success: false, message: "تعذر تحديث حالة المقعد" });
    }
  });

  socket.on("voice_stage:livekit_disconnected", async (
    data: { roomId: string },
    callback?: (res: { success: boolean; message?: string }) => void,
  ) => {
    try {
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      if (!canonicalRoomId || !socket.rooms.has(`room:${canonicalRoomId}`)) {
        callback?.({ success: false, message: "يجب الانضمام إلى الغرفة أولاً" });
        return;
      }

      await disconnectConfiguredLiveKitParticipant(
        canonicalRoomId,
        String(getUser().id),
      );
      callback?.({ success: true });
    } catch (error) {
      console.error("[VoiceStage] Failed to remove disconnected LiveKit participant:", error);
      callback?.({ success: false, message: "تعذر إنهاء جلسة LiveKit" });
    }
  });

  /**
   * صعود العضو على مقعد فارغ مباشرة بصلاحيته
   */
  socket.on("voice_stage:take_seat", async (data: { roomId: string; seatIndex: number }, callback?: (res: any) => void) => {
    try {
      const user = getUser();
      console.log(`[VoiceStage] take_seat: socket=${socket.id} user=${user.username} roomId=${data?.roomId} seatIndex=${data?.seatIndex}`);
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      const seatIndex = Number(data?.seatIndex);

      if (!canonicalRoomId || isNaN(seatIndex)) {
        callback?.({ success: false, message: "بيانات المقعد غير صالحة" });
        return;
      }

      if (!(await hasChatFeatureAccess(user, ["room_voice.use"]))) {
        callback?.({ success: false, message: "لا تملك صلاحية استخدام مايك الغرفة" });
        return;
      }

      // التحقق من الصلاحيات والإسكات
      if (user.muted) {
        callback?.({ success: false, message: "لا يمكنك الصعود على المايك، حسابك مكتوم حالياً" });
        return;
      }

      const stage = await getOrCreateRoomStage(canonicalRoomId);
      if (seatIndex < 0 || seatIndex >= stage.maxSeats) {
        callback?.({ success: false, message: "رقم المقعد خارج نطاق هذه الغرفة" });
        return;
      }

      await ensureConfiguredLiveKitRoom(canonicalRoomId);

      // جلب إطار المقعد الصوتي للمستخدم
      let seatFrameUrl = (user as any).seatFrameUrl || "";
      if (!seatFrameUrl && user.id && !user.id.startsWith("guest_")) {
        try {
          const profileRes = await dbPool.query(
            `SELECT seat_frame_url FROM user_profiles WHERE user_id = $1 LIMIT 1`,
            [user.id]
          );
          seatFrameUrl = profileRes.rows[0]?.seat_frame_url || "";
        } catch {}
      }

      const newSeat: VoiceSeat = {
        seatIndex,
        userId: user.id,
        username: user.username,
        role: user.role || "guest",
        avatar: user.avatar || "/pic.png",
        seatFrameUrl: seatFrameUrl || undefined,
        isMuted: false,
        isLocked: false,
        joinedAt: Date.now(),
      };

      const change = await voiceStageStore.takeSeat(canonicalRoomId, newSeat);
      if (!change.success || !change.stage) {
        callback?.({ success: false, message: change.message || "تعذر أخذ المقعد" });
        return;
      }

      let permissionSyncError: unknown;
      if (change.previousRoomId && change.previousRoomId !== canonicalRoomId) {
        try {
          await syncConfiguredLiveKitPublishPermission(change.previousRoomId, String(user.id), false);
        } catch (error) {
          permissionSyncError = error;
          console.error("[VoiceStage] Failed to revoke LiveKit publishing after moving rooms:", error);
        }
        if (change.previousStage) {
          await publishSocketEvent(change.previousRoomId, "voice_stage:seats_updated", change.previousStage);
        }
      }

      try {
        const seatCanPublish = canPublishFromSeat(newSeat, user.role) && !user.muted;
        await syncConfiguredLiveKitPublishPermission(
          canonicalRoomId,
          String(user.id),
          seatCanPublish,
        );
      } catch (error) {
        permissionSyncError = error;
        console.error("[VoiceStage] Failed to synchronize LiveKit publishing after taking a seat:", error);
      }
      await publishSocketEvent(canonicalRoomId, "voice_stage:seats_updated", change.stage);

      if (permissionSyncError) {
        callback?.({ success: false, message: "تم أخذ المقعد لكن تعذرت مزامنة صلاحية الصوت" });
        return;
      }
      callback?.({ success: true, seat: newSeat, payload: change.stage });
    } catch (err: any) {
      console.error("[VoiceStage] take_seat error:", err);
      callback?.({ success: false, message: err?.message || "تعذر أخذ المقعد" });
    }
  });

  /**
   * النزول من المقعد الصوتي طواعية
   */
  socket.on("voice_stage:leave_seat", async (data: { roomId: string }, callback?: (res: any) => void) => {
    try {
      const user = getUser();
      await vacateUserFromAllSeats(user.id, io, user.username);
      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ success: false, message: err?.message });
    }
  });

  /**
   * كتم / تشغيل مايك المتحدث نفسه
   */
  socket.on("voice_stage:toggle_mute", async (data: { roomId: string; isMuted: boolean }, callback?: (res: any) => void) => {
    try {
      const user = getUser();
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      if (!canonicalRoomId) {
        callback?.({ success: false, message: "معرف الغرفة غير صالح" });
        return;
      }
      await getOrCreateRoomStage(canonicalRoomId);
      const stage = await voiceStageStore.toggleMute(canonicalRoomId, user.id, Boolean(data.isMuted));
      const seat = stage?.seats.find((entry) => entry?.userId === String(user.id));
      let permissionSyncError: unknown;
      try {
        await syncConfiguredLiveKitPublishPermission(
          canonicalRoomId,
          String(user.id),
          canPublishFromSeat(seat, user.role) && !user.muted,
        );
      } catch (error) {
        permissionSyncError = error;
        console.error("[VoiceStage] Failed to synchronize LiveKit publishing after mute change:", error);
      }
      if (stage) await publishSocketEvent(canonicalRoomId, "voice_stage:seats_updated", stage);
      callback?.({
        success: !permissionSyncError,
        ...(permissionSyncError ? { message: "تعذر مزامنة صلاحية الصوت" } : {}),
      });
    } catch (err: any) {
      callback?.({ success: false, message: err?.message });
    }
  });

  /**
   * مزامنة حالة التحدث وهالة الصوت اللحظية لجميع أعضاء الغرفة
   */
  socket.on("voice_stage:speaking", async (data: { roomId: string; isSpeaking: boolean }) => {
    try {
      const user = getUser();
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      if (!canonicalRoomId) return;

      const payload = {
        roomId: canonicalRoomId,
        userId: user.id,
        isSpeaking: Boolean(data.isSpeaking),
      };

      await publishSocketEvent(canonicalRoomId, "voice_stage:user_speaking", payload, socket.id);
    } catch (err) {
      console.error("[VoiceStage] Speaking state broadcast failed:", err);
    }
  });

  /**
   * تبادل إشارات WebRTC الصوتية اللحظية بين المتحدثين والمستمعين
   */
  socket.on("voice_stage:signal", async (data: { roomId: string; targetUserId?: string; signal: any }) => {
    try {
      const user = getUser();
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      if (!canonicalRoomId) return;
      const roomName = `room:${canonicalRoomId}`;
      if (!socket.rooms.has(roomName) || !data?.signal || typeof data.signal !== "object") return;

      const payload = {
        roomId: canonicalRoomId,
        fromUserId: user.id,
        fromSocketId: socket.id,
        signal: data.signal,
      };

      if (data.targetUserId) {
        await publishUserEvent(String(data.targetUserId), "voice_stage:signal", payload);
      } else {
        await publishSocketEvent(canonicalRoomId, "voice_stage:signal", payload, socket.id);
      }
    } catch (e) {
      console.error("[VoiceStage] Signal error:", e);
    }
  });

  /**
   * قفل / فتح مقعد بواسطة المشرف أو المالك
   */
  socket.on("voice_stage:admin_lock_seat", async (data: { roomId: string; seatIndex: number; isLocked: boolean }, callback?: (res: any) => void) => {
    try {
      const user = getUser();
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      const seatIndex = Number(data?.seatIndex);
      if (!canonicalRoomId) {
        callback?.({ success: false, message: "معرف الغرفة غير صالح" });
        return;
      }
      const stage = await getOrCreateRoomStage(canonicalRoomId);

      // تحقق من الصلاحيات الإدارية
      if (!(await hasChatFeatureAccess(user, ["room_voice_moderation.use"]))) {
        callback?.({ success: false, message: "لا تملك صلاحية إدارة مقاعد المايك" });
        return;
      }

      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= stage.maxSeats) {
        callback?.({ success: false, message: "رقم المقعد خارج نطاق هذه الغرفة" });
        return;
      }
      const updatedStage = await voiceStageStore.setSeatLock(canonicalRoomId, seatIndex, Boolean(data.isLocked));
      if (!updatedStage) {
        callback?.({ success: false, message: "تعذر تحديث قفل المقعد" });
        return;
      }
      await publishSocketEvent(canonicalRoomId, "voice_stage:seats_updated", updatedStage);

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ success: false, message: err?.message });
    }
  });

  /**
   * إنزال متحدث من المقعد بواسطة المشرف أو المالك
   */
  socket.on("voice_stage:admin_kick_seat", async (data: { roomId: string; seatIndex: number }, callback?: (res: any) => void) => {
    try {
      const user = getUser();
      const canonicalRoomId = await resolveRoomId(data?.roomId);
      const seatIndex = Number(data?.seatIndex);
      if (!canonicalRoomId) {
        callback?.({ success: false, message: "معرف الغرفة غير صالح" });
        return;
      }
      const stage = await getOrCreateRoomStage(canonicalRoomId);

      if (!(await hasChatFeatureAccess(user, ["room_voice_moderation.use"]))) {
        callback?.({ success: false, message: "لا تملك صلاحية إدارة مقاعد المايك" });
        return;
      }

      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= stage.maxSeats) {
        callback?.({ success: false, message: "رقم المقعد خارج نطاق هذه الغرفة" });
        return;
      }
      const kicked = await voiceStageStore.kickSeat(canonicalRoomId, seatIndex);
      if (!kicked) {
        callback?.({ success: false, message: "تعذر إنزال العضو" });
        return;
      }
      let permissionSyncError: unknown;
      if (kicked.userId) {
        try {
          await syncConfiguredLiveKitPublishPermission(canonicalRoomId, kicked.userId, false);
        } catch (error) {
          permissionSyncError = error;
          console.error("[VoiceStage] Failed to revoke LiveKit publishing after seat kick:", error);
        }
      }
      await publishSocketEvent(canonicalRoomId, "voice_stage:seats_updated", kicked.stage);
      if (kicked.userId) {
        await publishUserEvent(kicked.userId, "voice_stage:kicked_from_seat", { roomId: canonicalRoomId });
      }

      callback?.({
        success: !permissionSyncError,
        ...(permissionSyncError ? { message: "تم إنزال العضو لكن تعذرت مزامنة صلاحية الصوت" } : {}),
      });
    } catch (err: any) {
      callback?.({ success: false, message: err?.message });
    }
  });

  /**
   * عند قطع الاتصال، يتم تفريغ المقعد تلقائياً
   */
  socket.on("disconnect", () => {
    const user = getUser();
    if (user?.id) {
      vacateUserFromAllSeats(user.id, io, user.username).catch((err) => {
        console.error("[VoiceStage] Failed to release disconnected user's seat:", err);
      });
    }
  });
}
