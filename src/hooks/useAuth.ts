import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getDeviceId, getDeviceSignature } from "@/lib/deviceFingerprint";
import { terminateUserSession } from "@/lib/authSession";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string | number;
  username: string;
  name: string;
  role: string;
  countryCode?: string;
  avatar?: string;
  profileMsg?: string;
  statusMsg?: string;
  [key: string]: unknown;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Decode a JWT-like payload.signature token and return the payload object, or null on failure */
function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const [payloadB64] = token.split(".");
    if (!payloadB64) return null;
    // base64url → base64
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Returns true when the token is present and not yet expired */
function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  const payload = decodeTokenPayload(token);
  if (!payload) return false;
  // Check exp claim (seconds since epoch)
  if (typeof payload.exp === "number") {
    return Date.now() < payload.exp * 1000;
  }
  // No exp claim → treat as valid (server will enforce)
  return true;
}

/** Build device fingerprint headers from localStorage if available */
function buildDeviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const fingerprint = getDeviceId?.() ?? localStorage.getItem("deviceFingerprint");
    const signature = getDeviceSignature?.() ?? localStorage.getItem("deviceSignature");
    if (fingerprint) headers["x-device-fingerprint"] = fingerprint;
    if (signature) headers["x-device-signature"] = signature;
  } catch {
    // Gracefully degrade – fingerprint is optional
  }
  return headers;
}

/** Normalise raw user object coming from the backend */
function normalizeUser(raw: Record<string, unknown>): AuthUser {
  const profileMsg =
    typeof raw.profileMsg === "string" && raw.profileMsg.trim()
      ? raw.profileMsg
      : typeof raw.statusMsg === "string" && raw.statusMsg.trim()
        ? raw.statusMsg
        : "";
  const statusMsg =
    typeof raw.statusMsg === "string" && raw.statusMsg.trim()
      ? raw.statusMsg
      : typeof raw.profileMsg === "string" && raw.profileMsg.trim()
        ? raw.profileMsg
        : "";
  return {
    ...raw,
    id: raw.id as string | number,
    username: raw.username as string,
    name: (raw.name as string) ?? (raw.username as string),
    role: (raw.role as string) ?? "guest",
    profileMsg,
    statusMsg,
  } as AuthUser;
}

/** Translate network/server errors into Arabic user-facing messages */
function toArabicError(err: unknown): string {
  if (err instanceof Error) {
    // Pass through already-localised messages from the server
    const msg = err.message;
    if (msg && !msg.startsWith("Failed to fetch") && !msg.startsWith("NetworkError")) {
      return msg;
    }
  }
  return "تعذر الاتصال بالسيرفر. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.";
}

// ─── Core auth fetcher ────────────────────────────────────────────────────────

async function authFetch(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ token: string; user: AuthUser }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildDeviceHeaders(),
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("تعذر الاتصال بخدمة الحسابات. أعد تشغيل السيرفر ثم حاول مرة أخرى.");
  }

  const data = (await response.json()) as {
    success?: boolean;
    token?: string;
    user?: Record<string, unknown>;
    message?: string;
  };

  if (!response.ok || !data.success) {
    throw new Error(data.message ?? "فشلت العملية. حاول مرة أخرى.");
  }

  if (!data.token || !data.user) {
    throw new Error("استجابة غير متوقعة من السيرفر. حاول مرة أخرى.");
  }

  return { token: data.token, user: normalizeUser(data.user) };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const navigate = useNavigate();

  const [state, setState] = useState<AuthState>(() => {
    // Initialise from localStorage on mount
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const userRaw = localStorage.getItem(USER_KEY);
      if (token && isTokenValid(token) && userRaw) {
        return {
          user: JSON.parse(userRaw) as AuthUser,
          token,
          isLoading: false,
          error: null,
        };
      }
    } catch {
      // Corrupt storage – start fresh
    }
    return { user: null, token: null, isLoading: false, error: null };
  });

  // Validate persisted token once on mount (expire check) and listen for auth events
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem("authToken");
    if (token && !isTokenValid(token)) {
      terminateUserSession(false);
      setState({ user: null, token: null, isLoading: false, error: null });
    }

    const handleAuthLogin = () => {
      try {
        const t = localStorage.getItem(TOKEN_KEY) || localStorage.getItem("authToken");
        const u = localStorage.getItem(USER_KEY) || localStorage.getItem("user");
        if (t && u && isTokenValid(t)) {
          setState({
            user: JSON.parse(u) as AuthUser,
            token: t,
            isLoading: false,
            error: null,
          });
        }
      } catch {}
    };

    const handleAuthLogout = () => {
      setState({ user: null, token: null, isLoading: false, error: null });
    };

    window.addEventListener("app-auth-login", handleAuthLogin);
    window.addEventListener("app-auth-logout", handleAuthLogout);
    return () => {
      window.removeEventListener("app-auth-login", handleAuthLogin);
      window.removeEventListener("app-auth-logout", handleAuthLogout);
    };
  }, []);

  /** Persist successful auth to localStorage and update state */
  const persist = useCallback((token: string, user: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // Keep legacy keys in sync so existing code (socket, etc.) keeps working
    localStorage.setItem("authToken", token);
    localStorage.setItem("user", JSON.stringify(user));
    setState({ user, token, isLoading: false, error: null });
  }, []);

  // ── login ──────────────────────────────────────────────────────────────────
  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const { token, user } = await authFetch("/api/auth/login", {
          username: username.trim(),
          password,
        });
        persist(token, user);
        return true;
      } catch (err) {
        setState((prev) => ({ ...prev, isLoading: false, error: toArabicError(err) }));
        return false;
      }
    },
    [persist]
  );

  // ── register ───────────────────────────────────────────────────────────────
  const register = useCallback(
    async (username: string, password: string, displayName?: string): Promise<boolean> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const body: Record<string, unknown> = {
          username: username.trim(),
          password,
        };
        if (displayName?.trim()) body.name = displayName.trim();
        const { token, user } = await authFetch("/api/auth/register", body);
        persist(token, user);
        return true;
      } catch (err) {
        setState((prev) => ({ ...prev, isLoading: false, error: toArabicError(err) }));
        return false;
      }
    },
    [persist]
  );

  // ── loginAsGuest ───────────────────────────────────────────────────────────
  const loginAsGuest = useCallback(
    async (displayName?: string): Promise<boolean> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const body: Record<string, unknown> = {};
        if (displayName?.trim()) body.username = displayName.trim();
        const { token, user } = await authFetch("/api/auth/guest", body);
        persist(token, user);
        return true;
      } catch (err) {
        setState((prev) => ({ ...prev, isLoading: false, error: toArabicError(err) }));
        return false;
      }
    },
    [persist]
  );

  // ── logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await terminateUserSession(true);
    setState({ user: null, token: null, isLoading: false, error: null });
    navigate("/");
  }, [navigate]);

  // ── getAuthHeaders ─────────────────────────────────────────────────────────
  const getAuthHeaders = useCallback((): { Authorization: string } | Record<string, never> => {
    const token = state.token ?? localStorage.getItem(TOKEN_KEY);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [state.token]);

  return {
    user: state.user,
    token: state.token,
    isLoading: state.isLoading,
    error: state.error,
    login,
    register,
    loginAsGuest,
    logout,
    getAuthHeaders,
  };
}

export type UseAuthReturn = ReturnType<typeof useAuth>;
