import assert from "node:assert/strict";
import test from "node:test";
import { normalizePresenceUserAssets } from "../server/socket/presenceHandlers";

test("online-user asset URLs use the same-origin MinIO proxy", () => {
  const user = normalizePresenceUserAssets({
    avatar: "http://127.0.0.1:9000/serene-panda/avatar.webp",
    giftedBannerUrl: "",
    giftedGiftIconUrl: "https://cdn.example.com/gift.webp",
    roleIconUrl: "http://127.0.0.1:9000/serene-panda/role.gif",
  });

  assert.deepEqual(user, {
    avatar: "/minio/avatar.webp",
    avatarFrameUrl: "",
    giftIconUrl: "",
    memberCardBgUrl: "",
    giftedBannerUrl: "",
    giftedGiftIconUrl: "https://cdn.example.com/gift.webp",
    giftedPromotionIconUrl: "",
    roleIconUrl: "/minio/role.gif",
  });
});
