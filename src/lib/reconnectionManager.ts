/**
 * Reconnection Manager — v2 (Mobile-Aware)
 * ──────────────────────────────────────────
 * يدير آلية إعادة الاتصال الذكية مع دعم كامل للهواتف:
 *
 *  ① visibilitychange  → عند العودة من تطبيق آخر، يتحقق فوراً ويُعيد الاتصال
 *  ② Page Lifecycle API (freeze/resume) → لاكتشاف التجميد المبكر على iOS/Android
 *  ③ online event      → عند استعادة الشبكة يُعيد الاتصال فوراً
 *  ④ keepalive ping    → ping دوري من العميل يمنع السيرفر من قطع الاتصال بسبب الصمت
 *  ⑤ sessionStorage    → يحفظ الغرفة حتى لو أُعيد تحميل الصفحة
 *  ⑥ تسجيل الخروج التلقائي إذا فشلت كل محاولات الاتصال
 */

import { getSocket, hasValidUserAuth, refreshSocketAuth } from "./socket";
import { browserAliveKeeper } from "./browserAliveKeeper";

// ─── ثوابت ──────────────────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS   = 15;       // أقصى محاولات قبل تسجيل الخروج
const VERIFY_MEMBERS_DELAY_MS  = 1_500;   // تأخير التحقق من الأعضاء
const KEEPALIVE_INTERVAL_MS    = 25_000;  // ping دوري (أقل من pingInterval في السيرفر)
const SESSION_ROOM_KEY         = "__last_room__";   // مفتاح sessionStorage

// ─── أنواع الأحداث ──────────────────────────────────────────────────────────
export type ReconnectionStatus = "connected" | "reconnecting" | "failed";

export interface ReconnectionState {
  status: ReconnectionStatus;
  attempt: number;
  maxAttempts: number;
}

// ─── حالة داخلية ────────────────────────────────────────────────────────────
let attemptCount     = 0;
let isManaging       = false;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let offKeeperTick: (() => void) | null = null;   // إلغاء اشتراك نبضة الحارس
let wasInBackground  = false;  // هل كان في الخلفية؟

// ─── إدارة الغرفة (ذاكرة + sessionStorage) ──────────────────────────────────

function saveRoomToSession(roomId: string, password: string) {
  try {
    sessionStorage.setItem(SESSION_ROOM_KEY, JSON.stringify({ roomId, password }));
  } catch {}
}

function loadRoomFromSession(): { roomId: string; password: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_ROOM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { roomId: string; password: string };
  } catch {
    return null;
  }
}

function clearRoomFromSession() {
  try { sessionStorage.removeItem(SESSION_ROOM_KEY); } catch {}
}

/** يحفظ آخر غرفة في الذاكرة والـ sessionStorage */
export function setLastRoom(roomId: string, password = "") {
  saveRoomToSession(roomId, password);
}

export function clearLastRoom() {
  clearRoomFromSession();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dispatch(state: ReconnectionState) {
  window.dispatchEvent(
    new CustomEvent<ReconnectionState>("reconnection:status", { detail: state })
  );
}

/** يتحقق من الغرفة ويُصحح عدد الأعضاء من السيرفر */
function verifyRoomMembership(roomId: string) {
  if (!roomId) return;
  const socket = getSocket();
  if (!socket.connected) return;

  socket.emit("get_room_members", { roomId }, (res: any) => {
    if (!res?.success) return;
    const count: number = res.memberCount ?? (res.members?.length ?? 0);
    window.dispatchEvent(
      new CustomEvent("reconnection:room_synced", {
        detail: { roomId, members: res.members || [], memberCount: count },
      })
    );
  });
}

/** يُعيد الانضمام للغرفة المحفوظة بعد نجاح الاتصال */
function rejoinLastRoom() {
  const saved = loadRoomFromSession();
  if (!saved?.roomId) return;

  const { roomId, password } = saved;
  const socket = getSocket();

  socket.emit("join_room", { roomId, password }, (res: any) => {
    if (res?.success) {
      window.dispatchEvent(
        new CustomEvent("reconnection:room_rejoined", {
          detail: { roomId: res.roomId || roomId, memberCount: res.memberCount ?? 0 },
        })
      );
      setTimeout(() => verifyRoomMembership(res.roomId || roomId), VERIFY_MEMBERS_DELAY_MS);
    } else {
      clearLastRoom();
      window.dispatchEvent(
        new CustomEvent("reconnection:room_rejoin_failed", {
          detail: { roomId, reason: res?.message || "unknown" },
        })
      );
    }
  });
}

/** يُعيد الاتصال بالتوكن الحديث فوراً دون انتظار */
function forceReconnectNow() {
  if (!hasValidUserAuth()) return;

  const socket = getSocket();

  if (socket.connected) {
    // كان متصلاً → تحقق فقط إذا كانت هناك غرفة محفوظة
    const saved = loadRoomFromSession();
    if (saved?.roomId && wasInBackground) {
      // تحقق أن المستخدم لا يزال في القائمة بعد العودة من الخلفية
      verifyRoomMembership(saved.roomId);
    }
    wasInBackground = false;
    return;
  }

  // غير متصل → ابدأ إعادة اتصال فورية بدون تأخير
  refreshSocketAuth();
  socket.io.opts.reconnectionDelay    = 0;    // بدون تأخير في المحاولة الأولى
  socket.io.opts.reconnectionDelayMax = 3000; // حد أدنى لتسريع المحاولات
  socket.io.opts.reconnection         = true;
  socket.connect();

  dispatch({ status: "reconnecting", attempt: 0, maxAttempts: MAX_RECONNECT_ATTEMPTS });
  wasInBackground = false;
}

/** يُشغّل ping دورياً لإبقاء الاتصال حياً */
function sendKeepalivePing() {
  const socket = getSocket();
  if (socket.connected) {
    // ping خفيف جداً — السيرفر يتجاهله إذا لم يُعرّفه
    socket.emit("ping_keepalive");
  }
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(sendKeepalivePing, KEEPALIVE_INTERVAL_MS);
  // نسخة احتياطية عبر نبضة الحارس: حتى لو خنق المتصفح المؤقتات في الخلفية،
  // تبقى نبضة browserAliveKeeper (المقاسة بـ Date.now لا setInterval) تبث ping
  offKeeperTick = browserAliveKeeper.onTick(sendKeepalivePing);
}

function stopKeepalive() {
  if (keepaliveTimer !== null) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  if (offKeeperTick !== null) {
    offKeeperTick();
    offKeeperTick = null;
  }
}

// ─── نقطة الدخول الرئيسية ───────────────────────────────────────────────────

export function startReconnectionManager() {
  if (isManaging) return;
  isManaging = true;

  const socket = getSocket();

  // ══════════════════════════════════════════════════════════════════════════
  // ① أحداث Socket.io
  // ══════════════════════════════════════════════════════════════════════════

  // انقطع الاتصال
  socket.on("disconnect", (reason: string) => {
    stopKeepalive();
    if (!hasValidUserAuth()) return;

    // انقطاع مقصود (logout) → لا نُعيد الاتصال
    if (
      reason === "io server disconnect" ||
      reason === "io client disconnect"
    ) return;

    attemptCount = 0;
    dispatch({ status: "reconnecting", attempt: 0, maxAttempts: MAX_RECONNECT_ATTEMPTS });
  });

  // تجربة إعادة الاتصال
  socket.io.on("reconnect_attempt", (attempt: number) => {
    attemptCount = attempt;

    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      socket.io.opts.reconnection = false;
      socket.disconnect();
      dispatch({ status: "failed", attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS });
      window.dispatchEvent(new CustomEvent("app-auth-logout"));
      return;
    }

    dispatch({ status: "reconnecting", attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS });
  });

  // نجاح إعادة الاتصال
  socket.io.on("reconnect", () => {
    attemptCount = 0;

    // استعادة إعدادات التأخير الطبيعية
    socket.io.opts.reconnectionDelay    = 1000;
    socket.io.opts.reconnectionDelayMax = 5000;

    dispatch({ status: "connected", attempt: 0, maxAttempts: MAX_RECONNECT_ATTEMPTS });
    startKeepalive();

    // استعادة قناة المستخدم
    try {
      const user = JSON.parse(localStorage.getItem("user") || "null");
      if (user?.id) socket.emit("join_user", { userId: user.id });
    } catch {}

    // إعادة الانضمام للغرفة المحفوظة
    rejoinLastRoom();
  });

  // نجاح الاتصال الأول (ليس reconnect)
  socket.on("connect", () => {
    startKeepalive();
  });

  // فشل نهائي
  socket.io.on("reconnect_failed", () => {
    dispatch({ status: "failed", attempt: attemptCount, maxAttempts: MAX_RECONNECT_ATTEMPTS });
    window.dispatchEvent(new CustomEvent("app-auth-logout"));
  });

  // خطأ: توكن منتهي
  socket.on("connect_error", (err: Error) => {
    const isAuthError =
      (err as any)?.data?.type === "AuthError" ||
      err.message?.toLowerCase().includes("unauthorized") ||
      err.message?.toLowerCase().includes("unauthenticated");

    if (isAuthError || !hasValidUserAuth()) {
      socket.io.opts.reconnection = false;
      socket.disconnect();
      dispatch({ status: "failed", attempt: attemptCount, maxAttempts: MAX_RECONNECT_ATTEMPTS });
      window.dispatchEvent(new CustomEvent("app-auth-logout"));
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ② Page Visibility API — العودة من الخلفية (الأهم للهواتف)
  // ══════════════════════════════════════════════════════════════════════════
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      // دخل الخلفية
      wasInBackground = true;
      return;
    }

    // عاد للأمام → تحقق وأعد الاتصال فوراً
    if (wasInBackground) {
      forceReconnectNow();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // ══════════════════════════════════════════════════════════════════════════
  // ③ Page Lifecycle API — freeze/resume (iOS Safari / Android Chrome)
  //    يُطلق قبل visibilitychange في بعض الأنظمة
  // ══════════════════════════════════════════════════════════════════════════
  const handleFreeze = () => {
    wasInBackground = true;
    stopKeepalive(); // وقف ping لأن JS سيتجمد
  };

  const handleResume = () => {
    // تشغيل فوري قبل visibilitychange
    forceReconnectNow();
  };

  window.addEventListener("freeze",  handleFreeze,  { passive: true } as any);
  window.addEventListener("resume",  handleResume,  { passive: true } as any);

  // ══════════════════════════════════════════════════════════════════════════
  // ④ استعادة الشبكة (Network Online)
  // ══════════════════════════════════════════════════════════════════════════
  const handleOnline = () => {
    forceReconnectNow();
  };

  window.addEventListener("online", handleOnline);

  // ══════════════════════════════════════════════════════════════════════════
  // ⑤ تنظيف عند إغلاق الصفحة (cleanup)
  // ══════════════════════════════════════════════════════════════════════════
  const handleUnload = () => {
    stopKeepalive();
  };

  window.addEventListener("pagehide", handleUnload, { passive: true });

  // ابدأ keepalive إذا كان متصلاً مسبقاً
  if (socket.connected) {
    startKeepalive();
  }
}

export function stopReconnectionManager() {
  isManaging = false;
  stopKeepalive();
}
