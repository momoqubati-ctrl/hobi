import { createHmac, timingSafeEqual } from "node:crypto";
import { getHeader, H3Event } from "h3";

const ADMIN_ROLES = new Set(["owner", "admin", "ispower", "مالك", "ادمن", "أدمن"]);

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

const verifySignature = (payload: string, signature: string) => {
  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const getAdminContext = (event: H3Event) => {
  const authHeader = getHeader(event, "authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature)) {
    return { ok: false as const, statusCode: 401, message: "جلسة الإدارة غير صالحة" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      return { ok: false as const, statusCode: 401, message: "انتهت صلاحية الجلسة" };
    }

    if (!ADMIN_ROLES.has(String(parsed.role || ""))) {
      return { ok: false as const, statusCode: 403, message: "لا تملك صلاحية الوصول إلى لوحة التحكم" };
    }

    return {
      ok: true as const,
      userId: String(parsed.sub || ""),
      username: String(parsed.username || ""),
      role: String(parsed.role || ""),
    };
  } catch {
    return { ok: false as const, statusCode: 401, message: "جلسة الإدارة غير صالحة" };
  }
};

export const getUserAuthContext = (event: H3Event) => {
  const authHeader = getHeader(event, "authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature)) {
    return { ok: false as const, statusCode: 401, message: "جلسة غير صالحة" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      return { ok: false as const, statusCode: 401, message: "انتهت صلاحية الجلسة" };
    }

    return {
      ok: true as const,
      userId: String(parsed.sub || ""),
      username: String(parsed.username || ""),
      role: String(parsed.role || "member"),
    };
  } catch {
    return { ok: false as const, statusCode: 401, message: "جلسة غير صالحة" };
  }
};
