import { defineEventHandler, readBody, getRequestHeader, setResponseStatus } from "h3";
import { createGuestSession } from "../../../services/authService";
import { detectCountryCode } from "../../../services/requestCountry";
import { logAccess } from "../../../services/accessLogger";

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const username = typeof body?.username === "string" ? body.username : undefined;
    const countryCode = detectCountryCode(event);
    const clientIp = getRequestHeader(event, "x-forwarded-for") || getRequestHeader(event, "x-real-ip") || "";
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
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء تسجيل الدخول" };
  }
});