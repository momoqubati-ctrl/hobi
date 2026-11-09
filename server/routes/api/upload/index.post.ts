import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { getUserAuthContext } from "../../../services/adminAccess";
import { saveUploadBuffer } from "../../../services/uploadStorage";

const ALLOWED_UPLOAD_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm", "mov", "avi"]);
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

export default defineEventHandler(async (event) => {
  try {
    const auth = getUserAuthContext(event);
    if (!auth.ok || !auth.userId) {
      setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
      return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
    }

    const body = await readBody<{ file?: unknown; filename?: unknown }>(event);
    if (typeof body?.file !== "string" || !body.file || typeof body?.filename !== "string" || !body.filename) {
      setResponseStatus(event, 400);
      return { success: false, message: "الملف واسم الملف مطلوبان" };
    }

    const matches = body.filename.match(/\.(\w+)$/);
    const extension = matches ? matches[1].toLowerCase() : "";
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      setResponseStatus(event, 415);
      return { success: false, message: "نوع الملف غير مدعوم" };
    }

    const buffer = Buffer.from(body.file, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
      setResponseStatus(event, 413);
      return { success: false, message: "حجم الملف يتجاوز 50 ميجابايت" };
    }

    const savedPath = await saveUploadBuffer({
      kind: "story",
      userId: auth.userId,
      extension,
      buffer,
    });

    if (!savedPath) {
      setResponseStatus(event, 500);
      return { success: false, message: "فشل حفظ الملف" };
    }

    return { success: true, url: savedPath };
  } catch (err) {
    console.error("[Upload] Error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء رفع الملف" };
  }
});
