import { defineEventHandler, getRouterParam, getRequestHeader, sendStream, setHeader, setResponseStatus } from "h3";
import fs from "node:fs";
import path from "node:path";
import { getUploadMimeType, resolveUploadFile } from "../../services/uploadStorage";

const SAFE_INLINE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif",
  "mp4", "webm", "mov", "avi",
  "mp3", "wav", "ogg", "m4a", "aac",
]);

export default defineEventHandler((event) => {
  // Always set security headers for upload route to protect against sniffing and XSS
  setHeader(event, "X-Content-Type-Options", "nosniff");
  setHeader(event, "X-Frame-Options", "DENY");
  setHeader(event, "Content-Security-Policy", "default-src 'none'; sandbox");

  const filename = getRouterParam(event, "filename") || "";
  const filePath = resolveUploadFile(filename);

  if (!filePath) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const mimeType = getUploadMimeType(filename);
  const range = getRequestHeader(event, "range");
  const ext = path.extname(filename).toLowerCase().replace(".", "");

  setHeader(event, "Accept-Ranges", "bytes");
  setHeader(event, "Content-Type", mimeType);
  setHeader(event, "Cache-Control", "public, max-age=31536000, immutable");

  // Force download for dangerous or non-display media (prevents stored XSS if SVG/HTML was previously uploaded)
  if (!SAFE_INLINE_EXTENSIONS.has(ext)) {
    setHeader(event, "Content-Disposition", `attachment; filename="${path.basename(filename)}"`);
  }

  // دعم البث الجزئي للفيديو والصوت للهواتف (HTTP 206 Partial Content)
  if (range && range.startsWith("bytes=")) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      setResponseStatus(event, 416);
      setHeader(event, "Content-Range", `bytes */${fileSize}`);
      return "Requested range not satisfiable";
    }

    const chunkLength = end - start + 1;
    setResponseStatus(event, 206);
    setHeader(event, "Content-Range", `bytes ${start}-${end}/${fileSize}`);
    setHeader(event, "Content-Length", String(chunkLength));

    return sendStream(event, fs.createReadStream(filePath, { start, end }));
  }

  setHeader(event, "Content-Length", String(fileSize));
  return sendStream(event, fs.createReadStream(filePath));
});
