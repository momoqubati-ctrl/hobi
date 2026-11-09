import { createServer } from "node:http";
import { createJiti } from "jiti";
import { Server } from "socket.io";

const jiti = createJiti(import.meta.url);
const [{ initializeSocketBroker, publishSocketEvent, publishUserEvent }, { redis }, { voiceStageStore }] = await Promise.all([
  jiti.import("../../server/socket/SocketBroker.ts"),
  jiti.import("../../server/services/redis.ts"),
  jiti.import("../../server/services/voiceStageStore.ts"),
]);

const httpServer = createServer();
const io = new Server(httpServer, { transports: ["websocket"] });
await initializeSocketBroker(io);

io.on("connection", (socket) => {
  const { userId, roomId } = socket.handshake.auth;
  if (userId) socket.join(`user:${userId}`);
  if (roomId) socket.join(`room:${roomId}`);

  socket.on("integration:ensure-stage", async ({ roomId: targetRoomId }, callback) => {
    try {
      await voiceStageStore.ensureStage({
        roomId: targetRoomId,
        maxSeats: 2,
        isVoiceChannel: false,
        seats: [null, null],
      });
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:take-seat", async ({ roomId: targetRoomId, seatIndex, userId: targetUserId }, callback) => {
    try {
      callback(await voiceStageStore.takeSeat(targetRoomId, {
        seatIndex,
        userId: targetUserId,
        username: targetUserId,
        avatar: "/pic.png",
        isMuted: false,
        isLocked: false,
        joinedAt: Date.now(),
      }));
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:get-stage", async ({ roomId: targetRoomId }, callback) => {
    try {
      callback({ stage: await voiceStageStore.getStage(targetRoomId) });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:set-lock", async ({ roomId: targetRoomId, seatIndex, isLocked }, callback) => {
    try {
      callback({ success: Boolean(await voiceStageStore.setSeatLock(targetRoomId, seatIndex, isLocked)) });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:heartbeat", async ({ roomId: targetRoomId, userId: targetUserId }, callback) => {
    try {
      callback({ heartbeat: await voiceStageStore.heartbeat(targetRoomId, targetUserId) });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:leave-seat", async ({ userId: targetUserId }, callback) => {
    try {
      callback({ success: Boolean(await voiceStageStore.leaveSeat(targetUserId)) });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:claim-exp", async ({ userId: targetUserId, minute }, callback) => {
    try {
      callback({ claimed: await voiceStageStore.claimExperienceTick(targetUserId, minute) });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:publish-room", async ({ roomId: targetRoomId, event, payload }, callback) => {
    try {
      await publishSocketEvent(targetRoomId, event, payload);
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:publish-user", async ({ userId: targetUserId, event, payload }, callback) => {
    try {
      await publishUserEvent(targetUserId, event, payload);
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });

  socket.on("integration:cleanup", async ({ roomIds, userIds }, callback) => {
    try {
      await redis.del(...roomIds.map((id) => `voice:stage:{voice-stage}:room:${id}`));
      await redis.del(...userIds.map((id) => `voice:stage:{voice-stage}:user:${id}`));
      await redis.srem("voice:stage:{voice-stage}:active", ...userIds);
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: String(error) });
    }
  });
});

httpServer.listen(0, "127.0.0.1", () => {
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    process.stderr.write("Unable to determine worker listening port\n");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ready: address.port })}\n`);
});
