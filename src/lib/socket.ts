import { io, Socket } from "socket.io-client";
import { getDeviceId, getDeviceSignature } from "./deviceFingerprint";

let socket: Socket | null = null;
let cachedDeviceId = "";
let cachedDeviceSignature = "";

function initDeviceCache() {
  cachedDeviceId = getDeviceId();
  cachedDeviceSignature = getDeviceSignature();
}

initDeviceCache();

function readSocketAuth(): Record<string, string> {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return {};

    const user = JSON.parse(raw);
    const profileMsg = typeof user.profileMsg === "string" ? user.profileMsg : "";
    const statusMsg = typeof user.statusMsg === "string" ? user.statusMsg : profileMsg;
    return {
      userId: user.id || "",
      username: user.name || "زائر",
      role: user.role || "guest",
      avatar: user.avatar || "/pic.png",
      countryCode: user.countryCode || "SA",
      avatarFrameUrl: user.avatarFrameUrl || "",
      giftIconUrl: user.giftIconUrl || "",
      messageBubbleStyle: user.messageBubbleStyle || "default",
      idreg: typeof user.idreg === "string" ? user.idreg : user.idreg ? `#${user.idreg}` : "",
      siteBadge: typeof user.siteBadge === "string" ? user.siteBadge : "",
      profileMsg,
      statusMsg,
      deviceFingerprint: cachedDeviceId,
      deviceSignature: cachedDeviceSignature,
    };
  } catch {
    return {};
  }
}

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io({
    path: "/ws",
    transports: ["websocket", "polling"],
    auth: readSocketAuth(),
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  return socket;
}

export function refreshSocketAuth(): void {
  if (socket) {
    socket.auth = readSocketAuth();
  }
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function logoutSocket(): void {
  if (socket) {
    try {
      socket.emit("user_logout");
    } catch {}
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
