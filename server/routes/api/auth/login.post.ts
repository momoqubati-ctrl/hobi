import { defineEventHandler, readBody, setResponseStatus, getRequestHeader } from "h3";
import { loginMember } from "../../../services/authService";
import { logAccess } from "../../../services/accessLogger";
import { detectCountryCode } from "../../../services/requestCountry";

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { username, password } = body;

    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password.trim()) {
      setResponseStatus(event, 400);
      return {
        success: false,
        code: "INVALID_LOGIN_INPUT",
        message: "اسم المستخدم وكلمة المرور مطلوبان",
      };
    }

    const countryCode = detectCountryCode(event);
    const clientIp = getRequestHeader(event, "x-forwarded-for") || getRequestHeader(event, "x-real-ip") || "";
    const deviceFingerprint = getRequestHeader(event, "x-device-fingerprint") || "";
    const deviceSignature = getRequestHeader(event, "x-device-signature") || "";
    const result = await loginMember({ username, password, countryCode, clientIp, deviceFingerprint, deviceSignature });
    
    if (!result.ok) {
      if (result.code === "BANNED") {
        await logAccess({
          event,
          state: "محاولة دخول محظور",
          username: username.trim(),
          topic: username.trim(),
        });
        setResponseStatus(event, 403);
        return {
          success: false,
          code: "BANNED",
          message: "تم حظرك من الموقع. لا يمكنك تسجيل الدخول.",
        };
      }

      // تسجيل محاولة تخمين
      await logAccess({
        event,
        state: "تخمين باسورد",
        username: username.trim(),
        topic: username.trim()
      });

      setResponseStatus(event, 401);
      return {
        success: false,
        code: result.code,
        message: result.message,
      };
    }

    // تسجيل دخول ناجح
    await logAccess({
      event,
      state: "دخول",
      username: result.session.user.username,
      topic: result.session.user.name
    });

    return {
      success: true,
      ...result.session,
    };
  } catch (error) {
    console.error("Login error:", error);
    setResponseStatus(event, 500);
    return {
      success: false,
      code: "LOGIN_FAILED",
      message: "حدث خطأ أثناء تسجيل الدخول",
    };
  }
});