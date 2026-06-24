import { dbPool } from "../db";
import { H3Event, getRequestHeader } from "h3";
import { detectCountryCode } from "./requestCountry";

export type LogState = 
  | "دخول" 
  | "خروج" 
  | "تخمين باسورد" 
  | "دخول زائر" 
  | "تسجيل عضوية" 
  | "عضوية مكررة"
  | "محاولة دخول محظور"
  | "تغيير اسم";

interface LogParams {
  event: H3Event;
  state: LogState;
  username: string;
  topic?: string;
  isin?: string; // المصدر أو الغرفة
}

/**
 * يقوم بتسجيل حركة في جدول logs القديم
 */
export const logAccess = async (params: LogParams) => {
  const { event, state, username, topic, isin } = params;
  
  try {
    const ip = getRequestHeader(event, "x-forwarded-for") || 
               getRequestHeader(event, "x-real-ip") || 
               "127.0.0.1";
    
    const countryCode = detectCountryCode(event);
    const userAgent = getRequestHeader(event, "user-agent") || "Unknown";
    const device = userAgent.slice(0, 500);

    const result = await dbPool.query(
      `INSERT INTO logs (state, topic, username, ip, code, device, isin, "time")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        state,
        topic || username,
        username,
        ip,
        countryCode,
        device,
        isin || "1",
        String(Date.now())
      ]
    );
    console.log(`[accessLogger] ✓ Logged: state=${state} username=${username} ip=${ip}`);
  } catch (error) {
    console.error("Failed to write access log:", error);
  }
};