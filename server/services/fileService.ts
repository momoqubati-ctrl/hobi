import { dbPool } from "../db";
import fs from "node:fs";
import path from "node:path";
import { saveUploadBuffer, normalizeUploadExtension, saveWithLocalFallback } from "./uploadStorage";
import { isMinioEnabled, uploadToMinio, deleteFromMinio } from "./minioClient";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = new Set([
  "jpg", "jpeg", "png", "webp", "gif",
  "mp4", "webm", "mov", "avi",
  "pdf", "doc", "docx", "xls", "xlsx", "zip", "rar", "txt", "csv", "json",
]);

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", mp4: "video/mp4", webm: "video/webm",
  mov: "video/quicktime", avi: "video/x-msvideo", pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip", rar: "application/vnd.rar", txt: "text/plain",
  csv: "text/csv", json: "application/json",
};

const getUploadDir = () => {
  const cwd = process.cwd();
  const dirs = [
    path.join(cwd, "public", "uploads", "files"),
    path.join(cwd, ".output", "public", "uploads", "files"),
  ];
  if (path.basename(cwd) === "server" && path.basename(path.dirname(cwd)) === ".output") {
    dirs.push(path.resolve(cwd, "..", "public", "uploads", "files"));
    dirs.push(path.resolve(cwd, "..", "..", "public", "uploads", "files"));
  }
  return Array.from(new Set(dirs));
};

const getFilename = (userId: string, extension: string) => {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "user";
  return `file_${safeUserId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
};

const saveFileToDisk = (filename: string, buffer: Buffer) => {
  const dirs = getUploadDir();
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);
  }
  return `uploads/files/${filename}`;
};

const saveFileToStorage = async (userId: string, extension: string, buffer: Buffer): Promise<string | null> => {
  if (!ALLOWED_TYPES.has(extension)) return null;
  if (buffer.length > MAX_FILE_SIZE) return null;

  const filename = getFilename(userId, extension);

  if (isMinioEnabled()) {
    const contentType = MIME_MAP[extension] || "application/octet-stream";
    return saveWithLocalFallback(
      async () => {
        await uploadToMinio(`uploads/files/${filename}`, buffer, contentType);
        return `uploads/files/${filename}`;
      },
      () => saveFileToDisk(filename, buffer),
    );
  }

  return saveFileToDisk(filename, buffer);
};

const deleteFileFromStorage = async (storagePath: string) => {
  const cwd = process.cwd();
  const dirs = [
    path.join(cwd, "public"),
    path.join(cwd, ".output", "public"),
  ];
  if (path.basename(cwd) === "server" && path.basename(path.dirname(cwd)) === ".output") {
    dirs.push(path.resolve(cwd, "..", "public"));
    dirs.push(path.resolve(cwd, "..", "..", "public"));
  }
  const filePaths = Array.from(new Set(dirs), (base) => path.join(base, storagePath));
  const hasLocalCopy = filePaths.some((filePath) => fs.existsSync(filePath));

  if (isMinioEnabled() && !hasLocalCopy) {
    await deleteFromMinio(storagePath);
  }

  for (const fp of filePaths) {
    if (fs.existsSync(fp)) {
      try { fs.unlinkSync(fp); } catch {}
    }
  }
};

export const listFiles = async (userId: string, folderPath: string = "/") => {
  const result = await dbPool.query(
    `SELECT id, user_id, name, folder_path, is_folder, mime_type, size, storage_path, created_at, updated_at
     FROM files
     WHERE user_id = $1 AND folder_path = $2
     ORDER BY is_folder DESC, name ASC`,
    [userId, folderPath],
  );

  return result.rows.map((row: any) => ({
    id: String(row.id),
    userId: row.user_id,
    name: row.name,
    folderPath: row.folder_path,
    isFolder: row.is_folder,
    mimeType: row.mime_type,
    size: row.size,
    storagePath: row.storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const createFolder = async (userId: string, name: string, parentPath: string = "/") => {
  if (!name.trim()) throw new Error("اسم المجلد مطلوب");
  if (name.includes("/")) throw new Error("اسم المجلد لا يمكن أن يحتوي على /");

  const folderPath = parentPath === "/" ? `/${name}/` : `${parentPath}${name}/`;

  const existing = await dbPool.query(
    `SELECT id FROM files WHERE user_id = $1 AND folder_path = $2 AND name = $3 AND is_folder = true`,
    [userId, parentPath, name],
  );
  if (existing.rows.length > 0) throw new Error("المجلد موجود مسبقاً");

  const result = await dbPool.query(
    `INSERT INTO files (user_id, name, folder_path, is_folder)
     VALUES ($1, $2, $3, true)
     RETURNING id, name, folder_path, is_folder, created_at`,
    [userId, name, parentPath],
  );

  const row = result.rows[0];
  return {
    id: String(row.id),
    name: row.name,
    folderPath: row.folder_path,
    isFolder: row.is_folder,
    createdAt: row.created_at,
  };
};

export const renameFile = async (fileId: string, userId: string, newName: string) => {
  if (!newName.trim()) throw new Error("الاسم الجديد مطلوب");
  if (newName.includes("/")) throw new Error("الاسم لا يمكن أن يحتوي على /");

  const result = await dbPool.query(
    `UPDATE files SET name = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING id, name, folder_path, is_folder, mime_type, size, updated_at`,
    [newName, fileId, userId],
  );

  if (result.rows.length === 0) throw new Error("ملف غير موجود");
  const row = result.rows[0];
  return {
    id: String(row.id),
    name: row.name,
    folderPath: row.folder_path,
    isFolder: row.is_folder,
    mimeType: row.mime_type,
    size: row.size,
    updatedAt: row.updated_at,
  };
};

export const deleteFile = async (fileId: string, userId: string) => {
  const result = await dbPool.query(
    `DELETE FROM files WHERE id = $1 AND user_id = $2
     RETURNING storage_path, is_folder, folder_path, name`,
    [fileId, userId],
  );

  if (result.rows.length === 0) throw new Error("ملف غير موجود");

  const row = result.rows[0];

  // Delete from storage if it's a file
  if (!row.is_folder && row.storage_path) {
    await deleteFileFromStorage(row.storage_path);
  }

  // If it's a folder, delete all children
  if (row.is_folder) {
    const childFolderPath = row.folder_path === "/" ? `/${row.name}/` : `${row.folder_path}${row.name}/`;
    const children = await dbPool.query(
      `SELECT storage_path FROM files WHERE user_id = $1 AND folder_path LIKE $2`,
      [userId, `${childFolderPath}%`],
    );
    for (const child of children.rows) {
      if (child.storage_path) await deleteFileFromStorage(child.storage_path);
    }
    await dbPool.query(
      `DELETE FROM files WHERE user_id = $1 AND folder_path LIKE $2`,
      [userId, `${childFolderPath}%`],
    );
  }

  return { success: true };
};

export const uploadFile = async (userId: string, base64Data: string, filename: string, folderPath: string = "/") => {
  const matches = filename.match(/\.(\w+)$/);
  if (!matches) throw new Error("امتداد الملف غير معروف");
  const extension = matches[1].toLowerCase();
  if (extension === "svg" || extension === "xml" || extension === "html" || extension === "htm") {
    throw new Error("نوع الملف غير مسموح به لأسباب أمنية");
  }

  const ext = normalizeUploadExtension(extension);
  if (!ext && !ALLOWED_TYPES.has(extension)) throw new Error("نوع الملف غير مدعوم");

  const finalExt = ext || extension;
  if (!ALLOWED_TYPES.has(finalExt)) throw new Error("نوع الملف غير مدعوم");

  const buffer = Buffer.from(base64Data, "base64");
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error("حجم الملف يتجاوز الحد المسموح به (50 ميغابايت)");
  }

  const quota = await getStorageQuota(userId);
  if (quota.used + buffer.length > quota.total) {
    throw new Error("تجاوزت المساحة التخزينية المسموح بها (500 ميغابايت)");
  }

  const storagePath = await saveFileToStorage(userId, finalExt, buffer);
  if (!storagePath) throw new Error("فشل حفظ الملف على القرص");

  const mimeType = MIME_MAP[finalExt] || "application/octet-stream";

  const result = await dbPool.query(
    `INSERT INTO files (user_id, name, folder_path, mime_type, size, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, folder_path, is_folder, mime_type, size, storage_path, created_at`,
    [userId, filename, folderPath, mimeType, buffer.length, storagePath],
  );

  const row = result.rows[0];
  return {
    id: String(row.id),
    name: row.name,
    folderPath: row.folder_path,
    isFolder: row.is_folder,
    mimeType: row.mime_type,
    size: row.size,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
};

export const getStorageQuota = async (userId: string) => {
  const used = await dbPool.query(
    `SELECT COALESCE(SUM(size), 0)::int as used FROM files WHERE user_id = $1 AND is_folder = false`,
    [userId],
  );
  const count = await dbPool.query(
    `SELECT COUNT(*)::int as count FROM files WHERE user_id = $1 AND is_folder = false`,
    [userId],
  );
  return {
    used: used.rows[0].used,
    total: 500 * 1024 * 1024, // 500 MB per user
    filesCount: count.rows[0].count,
  };
};
