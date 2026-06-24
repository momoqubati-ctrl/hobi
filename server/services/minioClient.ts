import { Client } from "minio";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "127.0.0.1";
const MINIO_PORT = Number(process.env.MINIO_PORT) || 9000;
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || "minioadmin";
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === "true";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "serene-panda";
const MINIO_PUBLIC_URL = process.env.MINIO_PUBLIC_URL || `/minio`;

let client: Client | null = null;
let enabled = false;

export const isMinioEnabled = () => enabled;

export const getMinioClient = (): Client | null => {
  if (!enabled) return null;
  return client;
};

export const initMinio = async () => {
  if (process.env.MINIO_ENABLED !== "true") {
    enabled = false;
    return;
  }

  try {
    client = new Client({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });

    const exists = await client.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await client.makeBucket(MINIO_BUCKET);
      console.log(`[MinIO] ✅ Created bucket "${MINIO_BUCKET}"`);
    }

    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${MINIO_BUCKET}/*`],
        },
      ],
    };
    await client.setBucketPolicy(MINIO_BUCKET, JSON.stringify(policy));

    enabled = true;
    console.log(`[MinIO] ✅ Connected to ${MINIO_ENDPOINT}:${MINIO_PORT} bucket="${MINIO_BUCKET}"`);
  } catch (err) {
    console.error("[MinIO] ❌ Connection failed:", err instanceof Error ? err.message : err);
    enabled = false;
    client = null;
  }
};

export const uploadToMinio = async (
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string | null> => {
  if (!enabled || !client) return null;

  try {
    await client.putObject(MINIO_BUCKET, key, buffer, buffer.length, {
      "Content-Type": contentType,
    });
    return `${MINIO_PUBLIC_URL}/${key}`;
  } catch (err) {
    console.error("[MinIO] Upload failed:", err instanceof Error ? err.message : err);
    return null;
  }
};

export const deleteFromMinio = async (key: string): Promise<boolean> => {
  if (!enabled || !client) return false;

  try {
    await client.removeObject(MINIO_BUCKET, key);
    return true;
  } catch (err) {
    console.error("[MinIO] Delete failed:", err instanceof Error ? err.message : err);
    return false;
  }
};

export const getMinioPublicUrl = (key: string) => `${MINIO_PUBLIC_URL}/${key}`;

/**
 * تحويل أي رابط صورة (MinIO، مسار نسبي، رابط كامل) إلى رابط يعمل من أي جهاز.
 * يُستخدم في كل مكان يعرض صور المستخدمين (القصص، البروفايل، الحائط، التعليقات).
 */
export const normalizeMinioUrl = (url: string): string => {
  if (!url) return "/pic.png";
  const trimmed = url.trim();
  if (!trimmed) return "/pic.png";
  // Data URIs — pass through as-is
  if (trimmed.startsWith("data:")) return trimmed;
  // Already has leading slash — pass through (e.g. /pic.png, /uploads/xxx.jpg)
  if (trimmed.startsWith("/")) return trimmed;
  // Relative path without leading slash (e.g. "pic.png") — add it
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `/${trimmed}`;
  }
  // HTTP URL — keep as-is (MinIO has public access, direct URL works from localhost)
  // If needed for production, the MINIO_PUBLIC_URL should be set to the public hostname
  return trimmed;
};
