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

  // الاشتراك في قنوات الغرف العامة
  subClient.psubscribe("pubsub:room:*").catch((err: any) => {
    console.error("[SocketBroker] Redis psubscribe failed:", err);
  });

  subClient.on("pmessage", (pattern: string, channel: string, dataStr: string) => {
    try {
      const match = channel.match(/^pubsub:room:(.+)$/);
      if (!match) return;
      const roomId = match[1];

      const { event, payload, excludeSocketId } = JSON.parse(dataStr);

      let target: any;
      if (roomId === "__global__") {
        target = io;
      } else {
        target = io.to(`room:${roomId}`);
      }

      if (excludeSocketId) {
        target = target.except(excludeSocketId) as any;
      }

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
    // Fallback to local emission if Redis is disabled
    if (localIo) {
      const roomName = `room:${roomId}`;
      const sockets = await localIo.in(roomName).fetchSockets();
      const socketIds = sockets.map((s: any) => s.id);
      console.log(`[SocketBroker] Publishing to room "${roomName}": ${sockets.length} sockets connected; socketIds=${JSON.stringify(socketIds)}`);
      let target = localIo.to(roomName);
      if (excludeSocketId) {
        target = target.except(excludeSocketId) as any;
      }
      target.emit(event, payload);
      console.log(`[SocketBroker] Emitted "${event}" to room "${roomName}"`);
    } else {
      console.error("[SocketBroker] localIo is null! Cannot publish event");
    }
    return;
  }

  const channel = `pubsub:room:${roomId}`;
  const data = JSON.stringify({ event, payload, excludeSocketId });
  await redisModule.redis.publish(channel, data);
}

export async function publishGlobalEvent(event: string, payload: any, excludeSocketId?: string): Promise<void> {
  const redisModule = await import("../services/redis");
  
  if (!redisModule.isRedisEnabled) {
    if (localIo) {
      let target: any = localIo;
      if (excludeSocketId) {
        target = target.except(excludeSocketId);
      }
      target.emit(event, payload);
    }
    return;
  }

  const channel = `pubsub:room:__global__`;
  const data = JSON.stringify({ event, payload, excludeSocketId });
  await redisModule.redis.publish(channel, data);
}
