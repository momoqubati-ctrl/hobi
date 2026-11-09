import { io, Socket } from "socket.io-client";
import { getDeviceId, getDeviceSignature } from "./deviceFingerprint";
import { useRealtimeStore } from "./realtime-store";

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
    const raw = localStorage.getItem("user") || localStorage.getItem("auth_user");
    if (!raw) return {};
    const token = localStorage.getItem("auth_token") || localStorage.getItem("authToken") || "";
    if (!token) return {};

    const user = JSON.parse(raw);
    const profileMsg = typeof user.profileMsg === "string" ? user.profileMsg : "";
    const statusMsg = typeof user.statusMsg === "string" ? user.statusMsg : profileMsg;
    let manualStatus: string | undefined = undefined;
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("manualStatus");
        if (stored === "busy" || stored === "away") {
          manualStatus = stored;
        }
      } catch {}
    }
    return {
      userId: user.id || "",
      token,
      username: user.username || user.name || "زائر",
      displayName: user.displayName || user.name || "",
      mentionName: user.mentionName || "",
      publicUserId: user.publicUserId || "",
      role: user.role || "guest",
      avatar: user.avatar || "/pic.png",
      countryCode: user.countryCode || "SA",
      status: manualStatus || "online",
      avatarFrameUrl: user.avatarFrameUrl || "",
      giftIconUrl: user.giftIconUrl || "",
      memberCardBgUrl: user.memberCardBgUrl || "",
      nameColor: user.nameColor || "",
      messageColor: user.messageColor || "",
      statusFontColor: user.statusFontColor || "",
      messageBubbleStyle: user.messageBubbleStyle || "default",
      idreg: typeof user.idreg === "string" ? user.idreg : user.idreg ? `#${user.idreg}` : "",
      siteBadge: typeof user.siteBadge === "string" ? user.siteBadge : "",
      profileMsg,
      statusMsg,
      giftedBannerUrl: typeof user.giftedBannerUrl === "string" ? user.giftedBannerUrl : "",
      giftedGiftIconUrl: typeof user.giftedGiftIconUrl === "string" ? user.giftedGiftIconUrl : "",
      giftedPromotionIconUrl: typeof user.giftedPromotionIconUrl === "string" ? user.giftedPromotionIconUrl : "",
      roleIconUrl: typeof user.roleIconUrl === "string" ? user.roleIconUrl : "",
      deviceFingerprint: cachedDeviceId,
      deviceSignature: cachedDeviceSignature,
    };
  } catch {
    return {};
  }
}

/** فك تشفير حمولة التوكن والتحقق من انتهاء صلاحيته */
function isSocketTokenValid(token: string): boolean {
  try {
    const [payloadB64] = token.split(".");
    if (!payloadB64) return false;
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    if (typeof payload.exp === "number") {
      // exp بالثواني أو بالملي ثانية
      const expMs = payload.exp > 1e11 ? payload.exp : payload.exp * 1000;
      return Date.now() < expMs;
    }
    return true; // بدون exp → السيرفر يتحكم
  } catch {
    return false;
  }
}

export function hasValidUserAuth(): boolean {
  try {
    const token = localStorage.getItem("auth_token") || localStorage.getItem("authToken");
    if (!token) return false;
    // التحقق من انتهاء الصلاحية قبل الاتصال
    if (!isSocketTokenValid(token)) return false;
    const raw = localStorage.getItem("user") || localStorage.getItem("auth_user");
    if (!raw) return false;
    const user = JSON.parse(raw);
    return Boolean(user && (user.id || user.username));
  } catch {
    return false;
  }
}

export function getSocket(): Socket {
  if (typeof window !== "undefined" && (window as any).__sessionReplaced) {
    if (socket && socket.connected) socket.disconnect();
    return socket || (io({ autoConnect: false }) as any);
  }
  const hasAuth = hasValidUserAuth();
  if (socket) {
    if (!socket.connected && hasAuth) {
      socket.auth = readSocketAuth();
      socket.connect();
    }
    return socket;
  }

  socket = io({
    path: "/ws",
    transports: ["websocket", "polling"],
    auth: readSocketAuth(),
    autoConnect: hasAuth,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,   // حد أقصى 8 ثانية بين المحاولات (أفضل للهواتف)
    timeout: 20000,
  });

  // التحقق من صلاحية التوكن عند خطأ الاتصال الأول فقط (قبل بدء reconnectionManager)
  // reconnectionManager يتولى الحالات اللاحقة
  socket.once("connect_error", (err: Error) => {
    const isAuthError =
      (err as any)?.data?.type === "AuthError" ||
      err.message?.toLowerCase().includes("unauthorized") ||
      err.message?.toLowerCase().includes("unauthenticated");

    if (isAuthError || !hasValidUserAuth()) {
      // توكن منتهي أو غير صالح → أوقف المحاولات وأخطر التطبيق
      socket?.io?.opts && (socket.io.opts.reconnection = false);
      socket?.disconnect();
      window.dispatchEvent(new CustomEvent("app-auth-logout"));
    }
  });

  socket.on("connect", () => {
    console.log("[CLIENT_SOCKET] connected", { id: socket?.id, userId: readSocketAuth().userId });
    // Join user-specific channels for call signaling
    const auth = readSocketAuth();
    if (auth.userId) {
      socket?.emit("join_user", { userId: auth.userId });
      console.log("[CLIENT_SOCKET] emitted join_user for", auth.userId);
    }
    // Re-apply manual status on connect/reconnect if set
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem("manualStatus");
        if (stored === "busy" || stored === "away") {
          socket?.emit("status_update", { status: stored });
        }
      } catch {}
    }
  });

  socket.on("disconnect", (reason: string) => {
    console.log("[CLIENT_SOCKET] disconnected", { reason, id: socket?.id });
  });

  socket.on("session_replaced", (payload: any) => {
    try {
      console.warn("[CLIENT_SOCKET] session_replaced received:", payload);
      if (typeof window !== "undefined") {
        (window as any).__sessionReplaced = true;
        if (socket) {
          socket.disconnect();
        }
        localStorage.removeItem("authToken");
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
        const msg = payload?.message || "تم تسجيل الدخول بحسابك من صفحة أو جهاز آخر";
        window.dispatchEvent(new CustomEvent("session-replaced-event", { detail: { message: msg } }));
        setTimeout(() => {
          window.location.replace(`/?session_replaced=1&msg=${encodeURIComponent(msg)}`);
        }, 300);
      }
    } catch (_) {}
  });

  socket.on("system_alert", (payload: any) => {
    try {
      if (payload?.message) {
        window.dispatchEvent(new CustomEvent("show-client-alert", {
          detail: {
            alertId: String(Date.now()),
            fromUsername: "النظام",
            fromAvatar: "/pic.png",
            message: payload.message,
            timestamp: Date.now(),
          }
        }));
      }
    } catch (_) {}
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
        if (serverUser.statusFontColor !== undefined && serverUser.statusFontColor !== user.statusFontColor) {
          user.statusFontColor = serverUser.statusFontColor;
          changed = true;
        }
        if (serverUser.giftedBannerUrl !== undefined && serverUser.giftedBannerUrl !== user.giftedBannerUrl) {
          user.giftedBannerUrl = serverUser.giftedBannerUrl;
          changed = true;
        }
        if (serverUser.giftedGiftIconUrl !== undefined && serverUser.giftedGiftIconUrl !== user.giftedGiftIconUrl) {
          user.giftedGiftIconUrl = serverUser.giftedGiftIconUrl;
          changed = true;
        }
         if (serverUser.giftedPromotionIconUrl !== undefined && serverUser.giftedPromotionIconUrl !== user.giftedPromotionIconUrl) {
          user.giftedPromotionIconUrl = serverUser.giftedPromotionIconUrl;
          changed = true;
        }
        if (serverUser.roleIconUrl !== undefined && serverUser.roleIconUrl !== user.roleIconUrl) {
          user.roleIconUrl = serverUser.roleIconUrl;
          changed = true;
        }
        if (serverUser.muted !== undefined && serverUser.muted !== user.muted) {
          user.muted = serverUser.muted;
          changed = true;
          window.dispatchEvent(new CustomEvent("user-mute-updated", { detail: serverUser.muted }));
        }
        if (changed) {
          localStorage.setItem("user", JSON.stringify(user));
          window.dispatchEvent(new CustomEvent("frame-updated"));
        }
      }
    } catch {}
  });

  socket.on("role:updated", (payload: any) => {
    try {
      console.log("[CLIENT_SOCKET] role:updated received in real-time:", payload);
      const raw = localStorage.getItem("user") || localStorage.getItem("auth_user");
      if (raw) {
        const user = JSON.parse(raw);
        if (payload.role !== undefined) user.role = payload.role;
        if (payload.roleName !== undefined) user.roleName = payload.roleName;
        if (payload.power !== undefined) user.power = payload.power;
        if (payload.roleIconUrl !== undefined) user.roleIconUrl = payload.roleIconUrl;
        if (Array.isArray(payload.permissions)) user.permissions = payload.permissions;

        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("auth_user", JSON.stringify(user));
      }

      if (payload.token) {
        localStorage.setItem("authToken", payload.token);
        localStorage.setItem("auth_token", payload.token);
      }

      // تحديث بيانات المصادقة للسوكيت فورياً
      refreshSocketAuth();

      // تحديث الصلاحيات اللحظية في المتجر
      if (Array.isArray(payload.permissions)) {
        useRealtimeStore.getState().setUserPermissions(payload.permissions);
      }

      // إشعار سياق تسجيل الدخول AuthContext وكافة المكونات فوراً دون ريفريش
      window.dispatchEvent(new CustomEvent("app-auth-login"));
      window.dispatchEvent(new CustomEvent("user-role-updated", { detail: payload }));
      window.dispatchEvent(new CustomEvent("frame-updated"));
    } catch (err) {
      console.error("[CLIENT_SOCKET] role:updated handler error:", err);
    }
  });

  socket.onAny((eventName: string, ...args: unknown[]) => {
    if (eventName === "room_kicked" || eventName === "system_alert" || eventName === "connect" || eventName === "disconnect") {
      console.log("[CLIENT_SOCKET] event", eventName, args);
    }
  });

  return socket;
}

export function refreshSocketAuth(): void {
  if (socket) {
    socket.auth = readSocketAuth();
  }
}

export function reconnectSocket(): Socket {
  const auth = readSocketAuth();
  try {
    // تتبّع مؤقت: من يستدعي إعادة الاتصال؟ (لاكتشاف أي حلقة connect/logout)
    console.warn("[CLIENT_SOCKET_TRACE] reconnectSocket called from:", (new Error().stack || "").split("\n").slice(2, 6).join(" | "));
  } catch {}
  if (socket) {
    socket.auth = auth;
    if (socket.connected) {
      // إبلاغ السيرفر بإزالة حضور الجلسة القديمة فوراً (يمنع احتساب الإنسان مرتين
      // أثناء فترة سماح قطع الاتصال، مثل ترقية الزائر إلى عضو)
      try {
        socket.emit("user_logout");
      } catch {}
      socket.disconnect();
    }
    if (hasValidUserAuth()) {
      socket.connect();
    }
    return socket;
  }
  return getSocket();
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
      if (socket.connected) {
        try {
          // تتبّع مؤقت: من يستدعي تسجيل الخروج؟
          console.warn("[CLIENT_SOCKET_TRACE] logoutSocket (user_logout) from:", (new Error().stack || "").split("\n").slice(2, 6).join(" | "));
        } catch {}
        socket.emit("user_logout");
      }
    } catch {}
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
