import { defineEventHandler, getRouterParam, sendStream, setHeader, setResponseStatus } from "h3";
import { getMinioClient } from "../../services/minioClient";
import { getUploadMimeType } from "../../services/uploadStorage";

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, "path") || "";
  if (!key) {
    setResponseStatus(event, 400);
    return "Missing path";
  }

  const client = getMinioClient();
  if (!client) {
    setResponseStatus(event, 404);
    return "MinIO not available";
  }
  const MINIO_BUCKET = process.env.MINIO_BUCKET || "serene-panda";

  try {
    const stream = await client.getObject(MINIO_BUCKET, key);
    const ext = key.split(".").pop() || "";
    setHeader(event, "Content-Type", getUploadMimeType(ext) || "application/octet-stream");
    setHeader(event, "Cache-Control", "public, max-age=31536000, immutable");
    return sendStream(event, stream);
  } catch (err: any) {
    if (err?.code === "NoSuchKey") {
      setResponseStatus(event, 404);
      return "Not found";
    }
    console.error("[MinIO Proxy] Error fetching", key, err);
    setResponseStatus(event, 500);
    return "Internal server error";
  }
});
