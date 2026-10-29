import { defineEventHandler, getHeader, setResponseStatus } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getUserContext } from "../../../services/permissionEngine";
import { getUserAuthoritativeRank } from "../../../services/powersService";

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

const verifySignature = (payload: string, signature: string) => {
  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature)) {
    setResponseStatus(event, 401);
    return { success: false, message: "جلسة غير صالحة" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) {
      setResponseStatus(event, 401);
      return { success: false, message: "انتهت صلاحية الجلسة" };
    }

    const userId = String(parsed.sub || "");
    const context = await getUserContext(userId);
    const actor = await getUserAuthoritativeRank(userId, parsed.username);
    const effectiveRole = actor?.roleName || parsed.role || "member";

    return {
      success: true,
      userId,
      role: effectiveRole,
      power: actor?.roleName || "",
      permissions: Array.from(context.permissions),
      rankPriority: context.rankPriority,
      isStaff: context.isStaff,
    };
  } catch (err: any) {
    console.error("Auth me error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء جلب سياق الحساب" };
  }
});
