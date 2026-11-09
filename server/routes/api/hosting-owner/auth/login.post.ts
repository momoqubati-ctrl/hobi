import {
  defineEventHandler,
  getRequestHeader,
  readBody,
  setCookie,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  HostingOwnerAuthError,
  authenticateHostingOwner,
} from "../../../../services/hostingOwnerAuthService";
import {
  getHostingOwnerPortalPath,
  isValidHostingOwnerPortalKey,
} from "../../../../services/hostingOwnerPortal";

const SESSION_COOKIE = "hosting_owner_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60;

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");

  if (!getHostingOwnerPortalPath()) {
    setResponseStatus(event, 503);
    return {
      success: false,
      code: "HOSTING_OWNER_PORTAL_NOT_CONFIGURED",
      message: "بوابة مالك الاستضافة غير مهيأة",
    };
  }
  if (!isValidHostingOwnerPortalKey(getRequestHeader(event, "x-hosting-owner-portal-key"))) {
    setResponseStatus(event, 404);
    return {
      success: false,
      code: "HOSTING_OWNER_PORTAL_NOT_FOUND",
      message: "الصفحة غير موجودة",
    };
  }

  const body = await readBody<{ username?: unknown; password?: unknown } | null>(event);
  if (
    !body ||
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    body.username.length > 128 ||
    body.password.length === 0 ||
    body.password.length > 256
  ) {
    setResponseStatus(event, 422);
    return { success: false, code: "INVALID_LOGIN_INPUT", message: "بيانات الدخول غير صالحة" };
  }

  try {
    const session = await authenticateHostingOwner(body.username, body.password);
    setCookie(event, SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/api/hosting-owner",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return { success: true, owner: session.owner };
  } catch (error) {
    if (error instanceof HostingOwnerAuthError) {
      if (error.code === "INVALID_HOSTING_OWNER_CREDENTIALS") {
        setResponseStatus(event, 401);
        return { success: false, code: error.code, message: error.message };
      }
      if (error.code === "HOSTING_OWNER_AUTH_NOT_CONFIGURED") {
        setResponseStatus(event, 503);
        return { success: false, code: error.code, message: error.message };
      }
    }

    console.error("[Hosting Owner Login] Failed:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "HOSTING_OWNER_LOGIN_FAILED", message: "تعذر تسجيل الدخول" };
  }
});
