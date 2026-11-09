import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { uploadToMinio, isMinioEnabled } from "./minioClient";

export type PrivateMessageMediaType = "image" | "video" | "audio" | "file";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_FILE_BYTES = 60 * 1024 * 1024;

const matchesSignature = (bytes: Buffer, contentType: string, mediaType: PrivateMessageMediaType) => {
  const mimeType = contentType.split(";")[0].trim().toLowerCase();

  if (mediaType === "image") {
    if (mimeType === "image/png") {
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
    if (mimeType === "image/jpeg") {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (mimeType === "image/webp") {
      return bytes.length >= 12 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP";
    }
    if (mimeType === "image/gif") {
      return bytes.length >= 6 &&
        (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a");
    }
    return false;
  }

  if (mediaType === "video") {
    if (mimeType === "video/mp4") {
      return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
    }
    if (mimeType === "video/webm") {
      return bytes.length >= 4 &&
        bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    }
    if (mimeType === "video/quicktime") {
      return bytes.length >= 8 && (
        bytes.toString("ascii", 4, 8) === "ftyp" ||
        bytes.toString("ascii", 4, 8) === "moov" ||
        bytes.toString("ascii", 4, 8) === "wide" ||
        bytes.toString("ascii", 4, 8) === "mdat"
      );
    }
    if (mimeType === "video/x-msvideo" || mimeType === "video/avi") {
      return bytes.length >= 12 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "AVI ";
    }
    return false;
  }

  if (mediaType === "audio") {
    if (mimeType === "audio/webm" || mimeType.startsWith("audio/webm;")) {
      return bytes.length >= 4 &&
        bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    }
    if (mimeType === "audio/mpeg" || mimeType === "audio/mp3") {
      return bytes.length >= 3 && (
        bytes.toString("ascii", 0, 3) === "ID3" ||
        (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
      );
    }
    if (mimeType === "audio/ogg" || mimeType.startsWith("audio/ogg;")) {
      return bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS";
    }
    if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
      return bytes.length >= 12 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WAVE";
    }
    if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a" || mimeType === "audio/aac") {
      if (bytes.length >= 8 && bytes.toString("ascii", 4, 8) === "ftyp") return true;
      if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return true;
      return bytes.length >= 8;
    }
    return false;
  }

  if (mediaType === "file") {
    // منع الملفات التنفيذية الخطيرة منعاً باتاً
    if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return false; // DOS/PE EXE (MZ)
    if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return false; // ELF
    if (bytes.length >= 4) {
      const magic = bytes.readUInt32BE(0);
      if (magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe) return false;
    }

    // PDF
    if (mimeType === "application/pdf") {
      return bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "%PDF";
    }
    // ZIP والملفات المكتبية الحديثة (docx, xlsx, pptx)
    if (
      mimeType === "application/zip" ||
      mimeType === "application/x-zip-compressed" ||
      mimeType.includes("wordprocessingml") ||
      mimeType.includes("spreadsheetml") ||
      mimeType.includes("presentationml")
    ) {
      return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    }
    // RAR
    if (mimeType === "application/vnd.rar" || mimeType === "application/x-rar-compressed") {
      return bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "Rar!";
    }
    // 7-Zip
    if (mimeType === "application/x-7z-compressed") {
      return bytes.length >= 6 && bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
    }
    // ملفات Office القديمة (doc, xls, ppt) - OLE
    if (
      mimeType === "application/msword" ||
      mimeType === "application/vnd.ms-excel" ||
      mimeType === "application/vnd.ms-powerpoint"
    ) {
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    }
    // نصوص عادية / CSV / JSON
    if (mimeType === "text/plain" || mimeType === "text/csv" || mimeType === "application/json") {
      const sample = bytes.subarray(0, Math.min(bytes.length, 512));
      return !sample.includes(0x00);
    }
    return bytes.length > 0;
  }

  return false;
};

export const getPrivateMessageMediaMaxBytes = (mediaType: PrivateMessageMediaType) => {
  if (mediaType === "audio") return MAX_AUDIO_BYTES;
  if (mediaType === "image") return MAX_IMAGE_BYTES;
  if (mediaType === "video") return MAX_VIDEO_BYTES;
  return MAX_FILE_BYTES;
};

export const validatePrivateMessageMedia = (
  bytes: Buffer,
  contentType: string,
  mediaType: PrivateMessageMediaType,
) => bytes.length > 0 &&
  bytes.length <= getPrivateMessageMediaMaxBytes(mediaType) &&
  matchesSignature(bytes, contentType, mediaType);

export const getPrivateMessageMediaExtension = (
  contentType: string,
  mediaType: PrivateMessageMediaType,
  originalFileName?: string,
): string => {
  if (originalFileName) {
    const ext = originalFileName.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{1,10}$/.test(ext)) {
      if (!["exe", "dll", "bat", "cmd", "sh", "ps1", "vbs", "js", "scr", "msi"].includes(ext)) {
        return ext;
      }
    }
  }

  const mime = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/vnd.rar": "rar",
    "application/x-rar-compressed": "rar",
    "application/x-7z-compressed": "7z",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/json": "json",
  };

  return map[mime] || (mediaType === "audio" ? "webm" : mediaType === "image" ? "jpg" : mediaType === "video" ? "mp4" : "bin");
};

export const savePrivateMedia = async (params: {
  userId: string;
  receiverId: string;
  mediaType: PrivateMessageMediaType;
  contentType: string;
  buffer: Buffer;
  originalFileName?: string;
}): Promise<{ mediaUrl: string; fileName: string; fileSize: number }> => {
  const extension = getPrivateMessageMediaExtension(params.contentType, params.mediaType, params.originalFileName);
  const safeUserId = params.userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "user";
  const uniqueKey = `${params.mediaType}_${safeUserId}_${Date.now()}_${randomBytes(4).toString("hex")}.${extension}`;
  const minioPath = `pm/${uniqueKey}`;

  let mediaUrl = "";
  if (isMinioEnabled()) {
    try {
      mediaUrl = await uploadToMinio(minioPath, params.buffer, params.contentType);
    } catch (err) {
      console.warn("[PrivateMedia] MinIO upload failed, falling back to disk:", err);
    }
  }

  // حفظ احتياطي على القرص في حال عدم توفر MinIO
  if (!mediaUrl) {
    const cwd = process.cwd();
    const diskDirs = [
      path.join(cwd, "public", "uploads", "pm"),
      path.join(cwd, ".output", "public", "uploads", "pm"),
    ];
    for (const dir of diskDirs) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, uniqueKey), params.buffer);
      } catch (e) {
        console.warn("[PrivateMedia] Disk write warning:", e);
      }
    }
    mediaUrl = `/uploads/pm/${uniqueKey}`;
  }

  const cleanFileName = params.originalFileName
    ? path.basename(params.originalFileName).slice(0, 200)
    : uniqueKey;

  return {
    mediaUrl,
    fileName: cleanFileName,
    fileSize: params.buffer.length,
  };
};
