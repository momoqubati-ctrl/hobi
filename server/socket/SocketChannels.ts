import type { Socket } from "socket.io";

export const SOCKET_CHANNELS = {
  room: (roomId: string) => `room:${roomId}`,
  presence: (roomId: string) => `presence:${roomId}`,
  social: (userId: string) => `room:social:${userId}`,
  moderation: "moderators_alerts",
  notifications: (userId: string) => `room:notifications:${userId}`,
  admin: "admin:realtime",
};

export function joinUserChannels(socket: Socket): void {
  const userId = String(socket.data.user?.id ?? "");
  const role = String(socket.data.user?.role ?? "guest");
  console.log("[SocketChannels] joinUserChannels called. userId:", userId, "role:", role);
  if (userId) {
    const notifRoom = SOCKET_CHANNELS.notifications(userId);
    console.log("[SocketChannels] Joining notification room:", notifRoom);
    socket.join(SOCKET_CHANNELS.social(userId));
    socket.join(notifRoom);
    socket.join(`user:${userId}`);
  } else {
    console.error("[SocketChannels] userId is empty! Socket will NOT join notification room");
  }
  if (role === "admin" || role === "owner") {
    socket.join(SOCKET_CHANNELS.admin);
    socket.join(SOCKET_CHANNELS.moderation);
  }
}
