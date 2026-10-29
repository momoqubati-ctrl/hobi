const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

process.env.MINIO_ENDPOINT = "127.0.0.1";
process.env.MINIO_PORT = "9000";
process.env.MINIO_BUCKET = "serene-panda";
process.env.MINIO_PUBLIC_URL = "http://127.0.0.1:9000/serene-panda/";

const jiti = createJiti(__filename);

test("wall post media arrays normalize legacy local MinIO URLs", async () => {
  const { mapWallPost } = await jiti.import(path.join(__dirname, "wallService.ts"));
  const post = mapWallPost({
    id: 1,
    mediaUrl: "http://127.0.0.1:9000/serene-panda//wall.gif",
    mediaUrls: JSON.stringify([
      "http://127.0.0.1:9000/serene-panda//wall.gif",
      "/uploads/cover.webp",
      "https://cdn.example.com/external.webp",
    ]),
  });

  assert.deepEqual(post.mediaUrls, [
    "/minio/wall.gif",
    "/uploads/cover.webp",
    "https://cdn.example.com/external.webp",
  ]);
});

test("wall post author assets normalize legacy local MinIO URLs", async () => {
  const { mapWallPost } = await jiti.import(path.join(__dirname, "wallService.ts"));
  const post = mapWallPost({
    id: 2,
    authorAvatar: "http://127.0.0.1:9000/serene-panda/avatar.webp",
    authorGiftedBannerUrl: "http://127.0.0.1:9000/serene-panda/banner.webp",
    authorGiftedGiftIconUrl: "http://127.0.0.1:9000/serene-panda/gift.webp",
    authorGiftedPromotionIconUrl: "http://127.0.0.1:9000/serene-panda/promotion.webp",
    authorRoleIconUrl: "http://127.0.0.1:9000/serene-panda/role.webp",
  });

  assert.deepEqual(post.author, {
    id: "",
    name: "زائر",
    avatar: "/minio/avatar.webp",
    nameColor: "",
    giftedBannerUrl: "/minio/banner.webp",
    giftedGiftIconUrl: "/minio/gift.webp",
    giftedPromotionIconUrl: "/minio/promotion.webp",
    roleIconUrl: "/minio/role.webp",
  });
});
