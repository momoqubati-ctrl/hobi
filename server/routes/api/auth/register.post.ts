import { defineEventHandler, readBody, setResponseStatus, getRequestHeader } from "h3";
import { registerMember } from "../../../services/authService";
import { detectCountryCode } from "../../../services/requestCountry";
import { logAccess } from "../../../services/accessLogger";
import { checkBan } from "../../../services/banCheck";
import { getClientIp } from "../../../middleware/rateLimiter";

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { username, password } = body || {};
    const countryCode = detectCountryCode(event);
    const clientIp = getClientIp(event);
    const deviceFingerprint = getRequestHeader(event, "x-device-fingerprint") || "";
    const deviceSignature = getRequestHeader(event, "x-device-signature") || "";

    const banCheck = await checkBan({ ip: clientIp, deviceFingerprint, deviceSignature });
    if (banCheck.banned) {
      setResponseStatus(event, 403);
      return { success: false, code: "BANNED", message: "لا يمكنك التسجيل. جهازك/IP محظور." };
    }

    if (typeof username !== "string" || username.trim().length < 3) {
      setResponseStatus(event, 400);
      return {
        success: false,
        code: "INVALID_USERNAME",
        message: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل",
      };
    }

    if (typeof password !== "string" || password.length < 6) {
      setResponseStatus(event, 400);
      return {
        success: false,
        code: "INVALID_PASSWORD",
        message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل",
      };
    }

    const result = await registerMember({ username, password, countryCode, clientIp, deviceFingerprint, deviceSignature });
    
    if (!result.ok) {
      if (result.code === "USERNAME_TAKEN") {
        // تسجيل محاولة تسجيل باسم مستخدم مكرر
        await logAccess({
          event,
          state: "عضوية مكررة",
          username: username.trim(),
          topic: username.trim()
        });
      }

      setResponseStatus(event, 409);
      return {
        success: false,
        code: result.code,
        message: result.message,
      };
    }

    // تسجيل نجاح إنشاء العضوية
    await logAccess({
      event,
      state: "تسجيل عضوية",
      username: result.session.user.username,
      topic: result.session.user.name
    });

    return {
      success: true,
      ...result.session,
    };
  } catch (error) {
    console.error("Register error:", error);
    setResponseStatus(event, 500);
    return {
      success: false,
      code: "REGISTER_FAILED",
      message: "حدث خطأ أثناء إنشاء الحساب",
    };
  }
});
