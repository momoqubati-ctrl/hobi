import fs from "node:fs";
import path from "node:path";

const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "mp4", "webm", "mov", "avi", "mp3", "wav", "ogg", "m4a"]);

/** Maximum file size per kind (bytes) */
const MAX_SIZES: Record<string, number> = {
  avatar: 2 * 1024 * 1024,   // 2MB (compressed by client)
  cover: 3 * 1024 * 1024,    // 3MB (compressed by client)
  story: 50 * 1024 * 1024,   // 50MB (videos allowed)
  wall: 50 * 1024 * 1024,    // 50MB (videos allowed)
  file: 50 * 1024 * 1024,    // 50MB (raw files)
};

export const normalizeUploadExtension = (value: string) => {
  const ext = value.toLowerCase() === "svg+xml" ? "svg" : value.toLowerCase();
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

export const saveUploadBuffer = (params: {
  kind: "avatar" | "cover" | "story" | "wall" | "file";
  userId: string;
  extension: string;
  buffer: Buffer;
}) => {
  const extension = normalizeUploadExtension(params.extension);
  if (!extension) return "";

  // Server-side size check
  const maxSize = MAX_SIZES[params.kind] || MAX_SIZES.file;
  if (params.buffer.length > maxSize) {
    console.error(`[Upload] File too large: ${params.buffer.length} bytes (max: ${maxSize}) for kind: ${params.kind}`);
    return "";
  }

  const safeUserId = params.userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "user";
  const filename = `${params.kind}_${safeUserId}_${Date.now()}.${extension}`;
  const dirs = getUploadDirectories();

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), params.buffer);
  }

  return `/uploads/${filename}`;
};

export const resolveUploadFile = (filename: string) => {
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
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".avi") return "video/x-msvideo";
  return "application/octet-stream";
};
