import { defineEventHandler, getHeader, readBody } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { saveUploadBuffer } from "../../../services/uploadStorage";

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

const verifySignature = (payload: string, signature: string) => {
  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export default defineEventHandler(async (event) => {
  try {
    const authHeader = getHeader(event, "authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !verifySignature(payload, signature)) {
      return { success: false, message: "جلسة غير صالحة" };
    }

    let userId = "";
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      userId = parsed.sub || parsed.username || "anonymous";
    } catch { userId = "anonymous"; }

    const body = await readBody<{ file?: string; filename?: string }>(event);
    if (!body?.file || !body?.filename) {
      return { success: false, message: "الملف مطلوب" };
    }

    const matches = body.filename.match(/\.(\w+)$/);
    const extension = matches ? matches[1].toLowerCase() : "";
    if (!["jpg", "jpeg", "png", "webp", "gif", "svg", "mp4", "webm", "mov", "avi"].includes(extension)) {
      return { success: false, message: "نوع الملف غير مدعوم" };
    }

    const buffer = Buffer.from(body.file, "base64");
    if (buffer.length > 50 * 1024 * 1024) {
      return { success: false, message: "حجم الملف يتجاوز 50 ميجابايت" };
    }

    const savedPath = await saveUploadBuffer({
      kind: "story",
      userId,
      extension,
      buffer,
    });

    if (!savedPath) {
      return { success: false, message: "فشل حفظ الملف" };
    }

    return { success: true, url: savedPath };
  } catch (err) {
    console.error("[Upload] Error:", err);
    return { success: false, message: "حدث خطأ أثناء رفع الملف" };
  }
});
