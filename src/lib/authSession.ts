/**
 * Auth Session Management
 * يدير التحقق من الجلسات النشطة وإنهاء الجلسات وتنظيف السوكيت والتخزين المحلي
 */
import { logoutSocket } from "./socket";
import type { AuthUser } from "@/hooks/useAuth";

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";
const LEGACY_TOKEN_KEY = "authToken";
const LEGACY_USER_KEY = "user";

/**
 * فك تشفير حمولة التوكن والتحقق من صلاحيتها
 */
export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const [payloadB64] = token.split(".");
    if (!payloadB64) return null;
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * التحقق من صلاحية التوكن وعدم انتهاء صلاحيته الزمنية
 */
export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = decodeTokenPayload(token);
  if (!payload) return false;
  if (typeof payload.exp === "number") {
    // exp claim بالثواني أو بالملي ثانية
    const expMs = payload.exp > 1e11 ? payload.exp : payload.exp * 1000;
    return Date.now() < expMs;
  }
  return true;
}

/**
 * الحصول على الجلسة النشطة الحالية (إن وجدت وكانت صالحة)
 */
export function getActiveSession(): { token: string; user: AuthUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);

    if (!token || !userRaw) return null;

    if (!isTokenValid(token)) {
      // توكن منتهي الصلاحية
      return null;
    }

    const user = JSON.parse(userRaw) as AuthUser;
    if (!user || (!user.id && !user.username)) {
      return null;
    }

    return { token, user };
  } catch {
    return null;
  }
}

/**
 * إنهاء جلسة المستخدم بالكامل وإغلاق السوكيت وتنظيف التخزين المحلي وإخطار السيرفر
 */
export async function terminateUserSession(notifyServer = true): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
  let userId: string | undefined;

  try {
    if (userRaw) {
      const parsed = JSON.parse(userRaw);
      userId = parsed.id ? String(parsed.id) : undefined;
    }
  } catch {}

  // 1. قطع اتصال السوكيت فوراً وإرسال حدث الخروج لإسقاط الحضور
  try {
    logoutSocket();
  } catch (err) {
    console.error("[authSession] logoutSocket failed:", err);
  }

  // 2. إخطار السيرفر بإنهاء كافة الجلسات المرتبطة بهذا المستخدم
  if (notifyServer && (token || userId)) {
    try {
      if (userId) {
        fetch("/__terminate_user_sessions__", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }).catch(() => {});
      }
      fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ userId }),
      }).catch((err) => {
        console.warn("[authSession] /api/auth/logout network error:", err);
      });
    } catch (err) {
      console.warn("[authSession] Failed to initiate logout request:", err);
    }
  }

  // 3. تنظيف جميع مفاتيح التخزين المحلي والجلسة
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
    sessionStorage.removeItem("manualStatus");
  } catch {}

  // 4. تصفير وإعادة تعيين متجر القصص لمنع تسريب بيانات المستخدم السابق
  try {
    const { useStoriesStore } = await import("./stories-store");
    useStoriesStore.getState().resetStories();
  } catch {}

  // 5. إشعار جميع المكونات في المتصفح بانتهاء الجلسة
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("app-auth-logout"));
    } catch {}
  }
}
