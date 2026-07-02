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
      memberCardBgUrl: user.memberCardBgUrl || "",
      nameColor: user.nameColor || "",
      messageColor: user.messageColor || "",
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

  socket.on("connected", (payload: any) => {
    try {
      const serverUser = payload?.user;
      if (!serverUser) return;
      const stored = localStorage.getItem("user");
      if (stored) {
        const user = JSON.parse(stored);
        let changed = false;
        if (serverUser.avatarFrameUrl !== undefined && serverUser.avatarFrameUrl !== user.avatarFrameUrl) {
          user.avatarFrameUrl = serverUser.avatarFrameUrl;
          changed = true;
        }
        if (serverUser.memberCardBgUrl !== undefined && serverUser.memberCardBgUrl !== user.memberCardBgUrl) {
          user.memberCardBgUrl = serverUser.memberCardBgUrl;
          changed = true;
        }
        if (serverUser.nameColor !== undefined && serverUser.nameColor !== user.nameColor) {
          user.nameColor = serverUser.nameColor;
          changed = true;
        }
        if (serverUser.messageColor !== undefined && serverUser.messageColor !== user.messageColor) {
          user.messageColor = serverUser.messageColor;
          changed = true;
        }
        if (changed) {
          localStorage.setItem("user", JSON.stringify(user));
          window.dispatchEvent(new CustomEvent("frame-updated"));
        }
      }
    } catch {}
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
