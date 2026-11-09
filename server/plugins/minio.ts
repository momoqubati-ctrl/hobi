import { initMinio, getMinioClient } from "../services/minioClient";
import { getUploadMimeType } from "../services/uploadStorage";
import { sendStream, setHeader, setResponseStatus, getRequestURL } from "h3";

let initialized = false;

const MINIO_BUCKET = process.env.MINIO_BUCKET || "serene-panda";

export default (nitroApp: any) => {
  const h3App = nitroApp.h3;

  console.log("[MinIO Plugin] h3App type:", typeof h3App, "has ~middleware:", Array.isArray(h3App["~middleware"]));

  h3App["~middleware"].push(async (event: any, next: any) => {
    const pathname = event.url?.pathname || event.req?.url || "";
    if (!pathname.startsWith("/minio/")) return next();

    if (process.env.MINIO_ENABLED === "false") {
      setResponseStatus(event, 404);
      return "MinIO is disabled";
    }

    if (!initialized) {
      initialized = true;
      await initMinio();
    }

    const url = getRequestURL(event);
    const key = String(url.pathname || "").replace(/^\/minio\//, "");
    if (!key) {
      setResponseStatus(event, 400);
      return "Missing path";
    }

    const client = getMinioClient();
    if (!client) {
      setResponseStatus(event, 404);
      return "MinIO not available";
    }

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

  nitroApp.hooks.hook("request", async () => {
    if (initialized) return;
    initialized = true;
    await initMinio();
  });
};
