/**
 * Socket Broker
 * يوزع أحداث WebSocket بين خوادم متعددة باستخدام Redis Pub/Sub بدون الحاجة لتثبيت حزم خارجية
 */
import { Server } from "socket.io";
import { createRedisClient, isRedisEnabled } from "../services/redis";

let subClient: any = null;
let localIo: Server | null = null;

export function initializeSocketBroker(io: Server): void {
  localIo = io;

  if (!isRedisEnabled) {
    console.log("[SocketBroker] Redis is disabled. Skipping Redis Pub/Sub subscriber broker.");
    return;
  }

  subClient = createRedisClient();

  subClient.psubscribe("pubsub:room:*", "pubsub:user:*").catch((err: any) => {
    console.error("[SocketBroker] Redis psubscribe failed:", err);
  });

  subClient.on("pmessage", (pattern: string, channel: string, dataStr: string) => {
    try {
      const roomMatch = channel.match(/^pubsub:room:(.+)$/);
      const userMatch = channel.match(/^pubsub:user:(.+)$/);
      if (!roomMatch && !userMatch) return;
      const { event, payload, excludeSocketId } = JSON.parse(dataStr);

      let target: any;
      if (userMatch) {
        target = io.to(`user:${userMatch[1]}`);
      } else if (roomMatch![1] === "__global__") {
        target = io;
      } else {
        target = io.to(`room:${roomMatch![1]}`);
      }

      if (excludeSocketId) {
        target = target.except(excludeSocketId) as any;
      }

      console.log(`[SOCKET_BROKER_TRACE] RECV pubsub target=${userMatch ? "user" : roomMatch![1] === "__global__" ? "GLOBAL" : "room"} event=${event} excludeSocketId=${excludeSocketId || "none"}`);
      target.emit(event, payload);
    } catch (err) {
      console.error("[SocketBroker] Error processing pubsub message:", err);
    }
  });

  console.log("[SocketBroker] Initialized Redis Pub/Sub subscriber broker");
}

export async function publishSocketEvent(roomId: string, event: string, payload: any, excludeSocketId?: string): Promise<void> {
  const redisModule = await import("../services/redis");
  
  if (!redisModule.isRedisEnabled) {
    if (localIo) {
      const roomName = `room:${roomId}`;
      const sockets = await localIo.in(roomName).fetchSockets();
      const socketIds = sockets.map((s: any) => s.id);
      console.log(`[SOCKET_BROKER_TRACE] PUBLISH room=${roomId} event=${event} localSockets=${socketIds.length} ids=${JSON.stringify(socketIds)} exclude=${excludeSocketId || "none"}`);
      let target = localIo.to(roomName);
      if (excludeSocketId) {
        target = target.except(excludeSocketId) as any;
      }
      target.emit(event, payload);
    } else {
      console.error("[SocketBroker] localIo is null! Cannot publish event");
    }
    return;
  }

  const channel = `pubsub:room:${roomId}`;
  const data = JSON.stringify({ event, payload, excludeSocketId });
  console.log(`[SOCKET_BROKER_TRACE] PUBLISH redis room=${roomId} event=${event} exclude=${excludeSocketId || "none"}`);
  await redisModule.redis.publish(channel, data);
}

export async function publishUserEvent(userId: string, event: string, payload: unknown, excludeSocketId?: string): Promise<void> {
  const resolvedUserId = String(userId || "").trim();
  if (!resolvedUserId) throw new Error("Cannot publish a user event without a user ID");

  const redisModule = await import("../services/redis");
  if (!redisModule.isRedisEnabled) {
    if (!localIo) throw new Error("Socket broker is not initialized");
    let target: any = localIo.to(`user:${resolvedUserId}`);
    if (excludeSocketId) target = target.except(excludeSocketId);
    target.emit(event, payload);
    return;
  }

  const data = JSON.stringify({ event, payload, excludeSocketId });
  await redisModule.redis.publish(`pubsub:user:${resolvedUserId}`, data);
}

export async function publishGlobalEvent(event: string, payload: any, excludeSocketId?: string): Promise<void> {
  const redisModule = await import("../services/redis");
  
  if (!redisModule.isRedisEnabled) {
    if (localIo) {
      let target: any = localIo;
      if (excludeSocketId) {
        target = target.except(excludeSocketId);
      }
      console.log(`[SOCKET_BROKER_TRACE] PUBLISH GLOBAL event=${event} (local) roomId=${payload?.roomId || "N/A"}`);
      target.emit(event, payload);
    }
    return;
  }

  const channel = `pubsub:room:__global__`;
  const data = JSON.stringify({ event, payload, excludeSocketId });
  console.log(`[SOCKET_BROKER_TRACE] PUBLISH GLOBAL redis event=${event} roomId=${payload?.roomId || "N/A"} memberCount=${payload?.memberCount ?? "N/A"}`);
  await redisModule.redis.publish(channel, data);
}
