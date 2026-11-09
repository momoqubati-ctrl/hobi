import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import { saveUploadBuffer } from "../../../services/uploadStorage";
import { verifyAuthToken } from "../../../services/authService";
import { hasChatFeatureAccess } from "../../../services/chatAuthorization";
import { getAdminContext } from "../../../services/adminAccess";
import { getChatUploadPermissionRequirements } from "../../../../src/lib/chatFeaturePermissions";

const ALLOWED_IMAGE = ["jpg", "jpeg", "png", "webp", "gif"];
const ALLOWED_VIDEO = ["mp4", "webm", "mov", "avi"];
const ALLOWED_AUDIO = ["mp3", "wav", "ogg", "m4a", "webm"];

export default defineEventHandler(async (event) => {
  try {
    const authHeader = getHeader(event, "authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const claims = verifyAuthToken(token);
    if (!claims || claims.type === "wallet_agent" || claims.type === "hosting_owner") {
      setResponseStatus(event, 401);
      return { success: false, message: "جلسة غير صالحة" };
    }

    const body = await readBody<{ file?: unknown; filename?: unknown; contentType?: unknown; purpose?: unknown }>(event);
    if (typeof body?.file !== "string" || !body.file || typeof body.filename !== "string" || !body.filename) {
      setResponseStatus(event, 400);
      return { success: false, message: "الملف مطلوب" };
    }

    const matches = body.filename.match(/\.(\w+)$/);
    const extension = matches ? matches[1].toLowerCase() : "";
    const isImage = ALLOWED_IMAGE.includes(extension);
    const isAudio = ALLOWED_AUDIO.includes(extension) &&
      (extension !== "webm" || (typeof body.contentType === "string" && body.contentType.startsWith("audio/")));
    const isVideo = ALLOWED_VIDEO.includes(extension) && !isAudio;

    if (!isImage && !isVideo && !isAudio) {
      setResponseStatus(event, 415);
      return { success: false, message: "نوع الملف غير مدعوم" };
    }

    if (body.purpose === undefined) {
      const admin = getAdminContext(event);
      if (!admin.ok) {
        setResponseStatus(event, admin.statusCode);
        return { success: false, message: admin.message };
      }
    } else {
      if (body.purpose !== "wall_post" && body.purpose !== "room_message") {
        setResponseStatus(event, 400);
        return { success: false, message: "غرض الرفع غير صالح" };
      }
      const requiredPermissions = getChatUploadPermissionRequirements(
        body.purpose,
        isAudio ? "audio" : isImage ? "image" : "video",
      );

      if (!(await hasChatFeatureAccess({ id: claims.sub, role: claims.role }, requiredPermissions))) {
        setResponseStatus(event, 403);
        return { success: false, message: "لا تملك صلاحية رفع الوسائط لهذه الميزة" };
      }
    }

    const maxSize = isVideo ? 50 * 1024 * 1024 : isAudio ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (body.file.length > Math.ceil(maxSize / 3) * 4) {
      setResponseStatus(event, 413);
      return { success: false, message: "حجم الملف يتجاوز الحد المسموح" };
    }
    const buffer = Buffer.from(body.file, "base64");
    if (buffer.length > maxSize) {
      setResponseStatus(event, 413);
      return { success: false, message: isVideo ? "حجم الفيديو يتجاوز 50 ميجابايت" : isAudio ? "حجم الصوت يتجاوز 10 ميجابايت" : "حجم الصورة يتجاوز 5 ميجابايت" };
    }

    const savedPath = await saveUploadBuffer({
      kind: "wall",
      userId: claims.sub,
      extension,
      buffer,
    });

    if (!savedPath) {
      return { success: false, message: "فشل حفظ الملف" };
    }

    return { success: true, url: savedPath, type: isImage ? "image" : isAudio ? "audio" : "video" };
  } catch (err) {
    console.error("[Wall Upload] Error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "حدث خطأ أثناء رفع الملف" };
  }
});
