import { Client } from "minio";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "127.0.0.1";
const MINIO_PORT = Number(process.env.MINIO_PORT) || 9000;
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin";
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === "true";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "serene-panda";

const protocol = MINIO_USE_SSL ? "https" : "http";
const defaultPublicUrl = `${protocol}://${MINIO_ENDPOINT}:${MINIO_PORT}/${MINIO_BUCKET}`;
const MINIO_PUBLIC_URL = process.env.MINIO_PUBLIC_URL || defaultPublicUrl;

let client: Client | null = null;
let enabled = false;

export const isMinioEnabled = () => {
  if (!client) {
    getMinioClient();
  }
  return enabled;
};

export const getMinioClient = (): Client | null => {
  if (!client) {
    try {
      client = new Client({
        endPoint: MINIO_ENDPOINT,
        port: MINIO_PORT,
        useSSL: MINIO_USE_SSL,
        accessKey: MINIO_ACCESS_KEY,
        secretKey: MINIO_SECRET_KEY,
      });
      enabled = true;
    } catch (err) {
      console.warn("[MinIO] init failed:", err);
      client = null;
      enabled = false;
    }
  }
  return client;
};

export const getMinioBucket = () => MINIO_BUCKET;

export const getMinioPublicUrl = (key: string) => {
  const baseUrl = MINIO_PUBLIC_URL.replace(/\/+$/, "");
  const safeKey = key.replace(/^\/+/, "");
  return normalizeMinioUrl(`${baseUrl}/${safeKey}`);
};

export const initMinio = async () => {
  const c = getMinioClient();
  if (!c) return;
  try {
    const exists = await c.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await c.makeBucket(MINIO_BUCKET, "us-east-1");
      const policy = JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${MINIO_BUCKET}/*`],
        }],
      });
      await c.setBucketPolicy(MINIO_BUCKET, policy);
      console.log(`[MinIO] bucket "${MINIO_BUCKET}" created & made public`);
    } else {
      console.log(`[MinIO] bucket "${MINIO_BUCKET}" exists`);
    }
  } catch (err) {
    console.error("[MinIO] init error:", err);
  }
};

export const uploadToMinio = async (key: string, buffer: Buffer, contentType: string): Promise<string> => {
  const c = getMinioClient();
  if (!c) throw new Error("MinIO not configured");
  await c.putObject(MINIO_BUCKET, key, buffer, buffer.length, { "Content-Type": contentType });
  return getMinioPublicUrl(key);
};

export const deleteFromMinio = async (key: string): Promise<void> => {
  const c = getMinioClient();
  if (!c) return;
  await c.removeObject(MINIO_BUCKET, key);
};

/**
 * تحويل أي رابط صورة (MinIO، مسار نسبي، رابط كامل) إلى رابط يعمل من أي جهاز.
 * يُستخدم في كل مكان يعرض صور المستخدمين (القصص، البروفايل، الحائط، التعليقات).
 */
export const normalizeMinioUrl = (url: string): string => {
  if (!url) return "/pic.png";
  const trimmed = url.trim();
  if (!trimmed) return "/pic.png";
  if (trimmed.startsWith("data:")) return trimmed;

  const toProxyUrl = (pathname: string, hasMinioPrefix: boolean) => {
    const segments = pathname.split("/").filter(Boolean);
    if (hasMinioPrefix && segments[0] === "minio") segments.shift();
    if (segments[0] === MINIO_BUCKET) segments.shift();
    return segments.length ? `/minio/${segments.join("/")}` : "/pic.png";
  };

  if (trimmed.startsWith("/minio/")) {
    return toProxyUrl(trimmed, true);
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      const internalHosts = new Set([MINIO_ENDPOINT.toLowerCase(), "localhost", "127.0.0.1", "::1"]);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      if (internalHosts.has(parsed.hostname.toLowerCase()) && port === MINIO_PORT) {
        return toProxyUrl(parsed.pathname, false);
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

export const normalizeOptionalMinioUrl = (url: unknown): string => {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed || /^(undefined|null)$/i.test(trimmed)) return "";
  return normalizeMinioUrl(trimmed);
};
