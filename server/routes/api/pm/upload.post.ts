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

const ALLOWED_IMAGE = ["jpg", "jpeg", "png", "webp", "gif"];
const ALLOWED_VIDEO = ["mp4", "webm", "mov", "avi"];

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

    const body = await readBody<{ file?: string; filename?: string; contentType?: string }>(event);
    if (!body?.file || !body?.filename) {
      return { success: false, message: "الملف مطلوب" };
    }

    const matches = body.filename.match(/\.(\w+)$/);
    const extension = matches ? matches[1].toLowerCase() : "";
    const isImage = ALLOWED_IMAGE.includes(extension);
    const isVideo = ALLOWED_VIDEO.includes(extension);

    if (!isImage && !isVideo) {
      return { success: false, message: "نوع الملف غير مدعوم (jpg, png, webp, gif, mp4, webm)" };
    }

    const buffer = Buffer.from(body.file, "base64");
    const maxSize = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return { success: false, message: isVideo ? "حجم الفيديو يتجاوز 50 ميجابايت" : "حجم الصورة يتجاوز 5 ميجابايت" };
    }

    const savedPath = await saveUploadBuffer({
      kind: "wall",
      userId,
      extension,
      buffer,
    });

    if (!savedPath) {
      return { success: false, message: "فشل حفظ الملف" };
    }

    return { success: true, url: savedPath, type: isImage ? "image" : "video" };
  } catch (err) {
    console.error("[PM Upload] Error:", err);
    return { success: false, message: "حدث خطأ أثناء رفع الملف" };
  }
});
