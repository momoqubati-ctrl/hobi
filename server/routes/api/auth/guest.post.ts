import { defineEventHandler, readBody, getRequestHeader, setResponseStatus } from "h3";
import { createGuestSession } from "../../../services/authService";
import { detectCountryCode } from "../../../services/requestCountry";
import { logAccess } from "../../../services/accessLogger";
import { getClientIp } from "../../../middleware/rateLimiter";

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event).catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username : undefined;
    const countryCode = detectCountryCode(event);
    const clientIp = getClientIp(event);
    const deviceFingerprint = getRequestHeader(event, "x-device-fingerprint") || "";
    const deviceSignature = getRequestHeader(event, "x-device-signature") || "";

    const session = await createGuestSession(username, countryCode, clientIp, deviceFingerprint, deviceSignature);

    await logAccess({
      event,
      state: "دخول زائر",
      username: session.user.username,
      topic: session.user.name,
    });

    return {
      success: true,
      ...session,
    };
  } catch (error: any) {
    if (error.code === "BANNED") {
      setResponseStatus(event, 403);
      return { success: false, code: "BANNED", message: "تم حظرك من الموقع" };
    }
    if (error.code === "USERNAME_TAKEN") {
      setResponseStatus(event, 409);
      return { success: false, code: "USERNAME_TAKEN", message: error.message || "هذا الاسم موجود من سابق قم بادخال اسم اخر" };
    }
    if (error.code === "USERNAME_REQUIRED") {
      setResponseStatus(event, 400);
      return { success: false, code: "USERNAME_REQUIRED", message: error.message || "يرجى إدخال اسم الزائر" };
    }
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء تسجيل الدخول" };
  }
});
