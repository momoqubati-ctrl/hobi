import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getHeader, getQuery, H3Event } from "h3";
import { isSystemOwnerUsername } from "./systemOwner";
import { isTokenRevoked, isUserActivelyBanned } from "./tokenRevocation";

const ADMIN_ROLES = new Set(["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"]);
const DEFAULT_DEV_SECRET = "dev-only-change-this-secret";

export const getConfiguredAdminSecret = (
  environment: NodeJS.ProcessEnv = process.env,
): string | null => {
  const secret = environment.AUTH_SECRET?.trim();
  return secret && secret !== DEFAULT_DEV_SECRET ? secret : null;
};

const verifySignature = (payload: string, signature: string, secret: string) => {
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const getAdminContext = (event: H3Event) => {
  const secret = getConfiguredAdminSecret();
  if (!secret) {
    return { ok: false as const, statusCode: 503, message: "مصادقة الإدارة غير مهيأة" };
  }

  const authHeader = getHeader(event, "authorization") || "";
  const queryToken = typeof getQuery(event)?.token === "string" ? (getQuery(event).token as string) : "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (authHeader || queryToken);
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature, secret)) {
    return { ok: false as const, statusCode: 401, message: "جلسة الإدارة غير صالحة" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed?.type === "wallet_agent" || parsed?.type === "hosting_owner") {
      return { ok: false as const, statusCode: 401, message: "نوع الجلسة غير صالح لهذا المسار" };
    }
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      return { ok: false as const, statusCode: 401, message: "انتهت صلاحية الجلسة" };
    }

    const username = String(parsed.username || "");
    const role = String(parsed.role || "");
    const userId = String(parsed.sub || "");
    const sessionId = createHash("sha256").update(token).digest("base64url");
    const iat = typeof parsed.iat === "number" ? parsed.iat : 0;

    // فحص إبطال التوكن / تسجيل الخروج
    if (isTokenRevoked({ sessionId, userId, username, iat })) {
      return { ok: false as const, statusCode: 401, message: "تم إنهاء هذه الجلسة أو تسجيل الخروج" };
    }

    // فحص الحظر النشط
    if (isUserActivelyBanned({ username, userId, event })) {
      return { ok: false as const, statusCode: 403, message: "تم حظرك من الموقع" };
    }

    const isSystemOwner = isSystemOwnerUsername(username);
    if (!ADMIN_ROLES.has(role) && !isSystemOwner) {
      return { ok: false as const, statusCode: 403, message: "لا تملك صلاحية الوصول إلى لوحة التحكم" };
    }

    return {
      ok: true as const,
      userId,
      username,
      role: isSystemOwner ? "owner" : ["owner", "ispower", "مالك"].includes(role.toLowerCase()) ? "admin" : role,
      sessionId,
      expiresAt: Number(parsed.exp),
    };
  } catch {
    return { ok: false as const, statusCode: 401, message: "جلسة الإدارة غير صالحة" };
  }
};

export const getUserAuthContext = (event: H3Event) => {
  const secret = getConfiguredAdminSecret();
  if (!secret) {
    return { ok: false as const, statusCode: 503, message: "مصادقة المستخدم غير مهيأة" };
  }
  const authHeader = getHeader(event, "authorization") || "";
  const queryToken = typeof getQuery(event)?.token === "string" ? (getQuery(event).token as string) : "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (authHeader || queryToken);
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature, secret)) {
    return { ok: false as const, statusCode: 401, message: "جلسة غير صالحة" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed?.type === "wallet_agent" || parsed?.type === "hosting_owner") {
      return { ok: false as const, statusCode: 401, message: "نوع الجلسة غير صالح لهذا المسار" };
    }
    if (
      typeof parsed?.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= Date.now()
    ) {
      return { ok: false as const, statusCode: 401, message: "انتهت صلاحية الجلسة" };
    }

    const userId = String(parsed.sub || "");
    const username = String(parsed.username || "");
    const sessionId = createHash("sha256").update(token).digest("base64url");
    const iat = typeof parsed.iat === "number" ? parsed.iat : 0;

    // فحص إبطال التوكن / تسجيل الخروج
    if (isTokenRevoked({ sessionId, userId, username, iat })) {
      return { ok: false as const, statusCode: 401, message: "تم إنهاء هذه الجلسة أو تسجيل الخروج" };
    }

    // فحص الحظر النشط
    if (isUserActivelyBanned({ username, userId, event })) {
      return { ok: false as const, statusCode: 403, message: "تم حظرك من الموقع" };
    }

    return {
      ok: true as const,
      userId,
      username,
      role: isSystemOwnerUsername(parsed.username)
        ? "owner"
        : ["owner", "ispower", "مالك"].includes(String(parsed.role || "").toLowerCase())
          ? "admin"
          : String(parsed.role || "member"),
      sessionId,
      expiresAt: Number(parsed.exp),
    };
  } catch {
    return { ok: false as const, statusCode: 401, message: "جلسة غير صالحة" };
  }
};
