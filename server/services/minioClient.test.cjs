const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

process.env.MINIO_ENDPOINT = "127.0.0.1";
process.env.MINIO_PORT = "9000";
process.env.MINIO_BUCKET = "serene-panda";
process.env.MINIO_PUBLIC_URL = "http://127.0.0.1:9000/serene-panda/";

const jiti = createJiti(__filename);

test("local MinIO URLs use the HTTPS proxy and normalize legacy bucket paths", async () => {
  const { normalizeMinioUrl } = await jiti.import(path.join(__dirname, "minioClient.ts"));

  assert.equal(
    normalizeMinioUrl("http://127.0.0.1:9000/serene-panda//avatar.webp"),
    "/minio/avatar.webp",
  );
  assert.equal(
    normalizeMinioUrl("/minio/serene-panda//avatar.webp"),
    "/minio/avatar.webp",
  );
});

test("new local uploads use a normalized same-origin proxy URL", async () => {
  const { getMinioPublicUrl } = await jiti.import(path.join(__dirname, "minioClient.ts"));

  assert.equal(getMinioPublicUrl("uploads/files/asset.webp"), "/minio/uploads/files/asset.webp");
});

test("missing optional media URLs remain empty and external URLs are preserved", async () => {
  const { normalizeOptionalMinioUrl } = await jiti.import(path.join(__dirname, "minioClient.ts"));

  assert.equal(normalizeOptionalMinioUrl(undefined), "");
  assert.equal(normalizeOptionalMinioUrl("undefined"), "");
  assert.equal(normalizeOptionalMinioUrl("https://cdn.example.com/avatar.webp"), "https://cdn.example.com/avatar.webp");
});

test("non-MinIO app paths and data URLs are preserved", async () => {
  const { normalizeMinioUrl } = await jiti.import(path.join(__dirname, "minioClient.ts"));

  assert.equal(normalizeMinioUrl("/uploads/avatar.webp"), "/uploads/avatar.webp");
  assert.equal(normalizeMinioUrl("pic.png"), "/pic.png");
  assert.equal(normalizeMinioUrl("data:image/png;base64,abc"), "data:image/png;base64,abc");
});
