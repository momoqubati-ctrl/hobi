import fs from "node:fs";
import path from "node:path";
import { isMinioEnabled, uploadToMinio } from "./minioClient";

const allowedExtensions = new Set([
  "jpg", "jpeg", "png", "webp", "gif",
  "mp4", "webm", "mov", "avi", "mkv",
  "mp3", "wav", "ogg", "m4a", "aac",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "zip", "rar", "7z", "txt", "csv", "json",
]);

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", mp4: "video/mp4", webm: "video/webm",
  mov: "video/quicktime", avi: "video/x-msvideo", mp3: "audio/mpeg",
  wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", mkv: "video/x-matroska",
  pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  txt: "text/plain", csv: "text/csv", json: "application/json",
};

/** Maximum file size per kind (bytes) */
const MAX_SIZES: Record<string, number> = {
  avatar: 2 * 1024 * 1024,   // 2MB (compressed by client)
  cover: 3 * 1024 * 1024,    // 3MB (compressed by client)
  story: 50 * 1024 * 1024,   // 50MB (videos allowed)
  wall: 50 * 1024 * 1024,    // 50MB (videos allowed)
  file: 50 * 1024 * 1024,    // 50MB (raw files)
};

export const normalizeUploadExtension = (value: string) => {
  const ext = value.toLowerCase().replace(/^\./, "");
  if (ext === "svg" || ext === "svg+xml" || ext === "xml" || ext === "html" || ext === "htm") {
    return "";
  }
  return allowedExtensions.has(ext) ? ext : "";
};

const getUploadDirectories = () => {
  const cwd = process.cwd();
  const dirs = [
    path.join(cwd, "public", "uploads"),
    path.join(cwd, ".output", "public", "uploads"),
  ];

  if (path.basename(cwd) === "server" && path.basename(path.dirname(cwd)) === ".output") {
    dirs.push(path.resolve(cwd, "..", "public", "uploads"));
    dirs.push(path.resolve(cwd, "..", "..", "public", "uploads"));
  }

  return Array.from(new Set(dirs));
};

const getFilename = (kind: string, userId: string, extension: string) => {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "user";
  return `${kind}_${safeUserId}_${Date.now()}.${extension}`;
};

const saveToDisk = (filename: string, buffer: Buffer) => {
  const dirs = getUploadDirectories();
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);
  }
  return `/uploads/${filename}`;
};

const getContentType = (extension: string) => MIME_MAP[extension] || "application/octet-stream";

export const saveUploadBuffer = async (params: {
  kind: "avatar" | "cover" | "story" | "wall" | "file";
  userId: string;
  extension: string;
  buffer: Buffer;
}) => {
  const extension = normalizeUploadExtension(params.extension);
  if (!extension) return "";

  const maxSize = MAX_SIZES[params.kind] || MAX_SIZES.file;
  if (params.buffer.length > maxSize) {
    console.error(`[Upload] File too large: ${params.buffer.length} bytes (max: ${maxSize}) for kind: ${params.kind}`);
    return "";
  }

  const filename = getFilename(params.kind, params.userId, extension);

  // Try MinIO first if enabled
  if (isMinioEnabled()) {
    const contentType = getContentType(extension);
    const url = await uploadToMinio(filename, params.buffer, contentType);
    if (url) return url;
    // Fallback to disk if MinIO fails
  }

  return saveToDisk(filename, params.buffer);
};

export const resolveUploadFile = (filename: string) => {
  // MinIO URLs are served directly by MinIO, not from local disk
  if (filename.startsWith("http")) return null;

  const safeFilename = path.basename(filename);
  if (!/^[a-zA-Z0-9_.-]+$/.test(safeFilename)) return null;

  for (const dir of getUploadDirectories()) {
    const filePath = path.join(dir, safeFilename);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) return filePath;
    }
  }

  return null;
};

export const getUploadMimeType = (filename: string) => {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  return getContentType(ext);
};
