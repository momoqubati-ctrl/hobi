import assert from "node:assert/strict";
import test from "node:test";
import { validatePrivateMessageMedia } from "../server/services/privateMessageMedia";

test("validates allowed private media by content type and file signature", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(validatePrivateMessageMedia(png, "image/png", "image"), true);
  assert.equal(validatePrivateMessageMedia(png, "image/svg+xml", "image"), false);
  assert.equal(validatePrivateMessageMedia(png, "video/mp4", "video"), false);
  assert.equal(validatePrivateMessageMedia(Buffer.from("<svg"), "image/svg+xml", "image"), false);
});

test("recognizes WebM audio and rejects files over their media-specific limit", () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
  assert.equal(validatePrivateMessageMedia(webm, "audio/webm;codecs=opus", "audio"), true);
  assert.equal(validatePrivateMessageMedia(webm, "video/webm", "video"), true);
  assert.equal(
    validatePrivateMessageMedia(Buffer.alloc(2 * 1024 * 1024 + 1), "audio/webm", "audio"),
    false,
  );
});
