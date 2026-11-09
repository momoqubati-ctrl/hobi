/**
 * حد إرسال التنبيهات (Anti-Spam) لـ profile:sendAlert.
 *
 * فجوة أمنية أصلية: أي عضو كان يستطيع إرسال تنبيهات لأي عضو دون فحص صلاحيات
 * ولا حدود للتكرار. بعد إضافة فحص صلاحية alert.edit، يضيف هذا المحدد
 * سقفاً زمنياً منزلقاً (sliding window) في الذاكرة لكل مستخدم.
 */

export interface AlertThrottleOptions {
  /** أقصى عدد تنبيهات في النافذة الزمنية */
  maxPerWindow?: number;
  /** حجم النافذة الزمنية بالميلي ثانية */
  windowMs?: number;
}

interface ThrottleState {
  timestamps: number[];
}

const DEFAULT_MAX_PER_WINDOW = 5;
const DEFAULT_WINDOW_MS = 60_000;

// كل عملية نسخ لهذه الوحدة تملك خزنتها الخاصة (يدعم الاختبار المعزول)
const createThrottleStore = () => new Map<string, ThrottleState>();

export interface AlertThrottle {
  /** يقرر إن كان الإرسال مسموحاً ويسجل المحاولة إن كان كذلك */
  allowAttempt(userId: string, nowMs?: number): boolean;
  /** يزيل سجل مستخدم (مثلاً عند تسجيل خروجه أو في الاختبارات) */
  reset(userId: string): void;
}

export function createAlertThrottle(
  store: Map<string, ThrottleState> = createThrottleStore(),
  options: AlertThrottleOptions = {},
): AlertThrottle {
  const maxPerWindow = options.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;

  return {
    allowAttempt(userId: string, nowMs?: number): boolean {
      const key = String(userId || "").trim();
      if (!key) return false;

      const now = typeof nowMs === "number" ? nowMs : Date.now();
      const state = store.get(key) || { timestamps: [] };
      state.timestamps = state.timestamps.filter((t) => now - t < windowMs);

      if (state.timestamps.length >= maxPerWindow) {
        store.set(key, state);
        return false;
      }

      state.timestamps.push(now);
      store.set(key, state);
      return true;
    },

    reset(userId: string): void {
      store.delete(String(userId || "").trim());
    },
  };
}

/** المحدد المشترك لعملية التشغيل */
export const alertThrottle = createAlertThrottle();
