import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceProviderMode } from "../src/lib/voiceProviderMode";

test("keeps the WebRTC provider selected by the server", () => {
  assert.equal(parseVoiceProviderMode("webrtc"), "webrtc");
});

test("selects LiveKit only when the server reports LiveKit", () => {
  assert.equal(parseVoiceProviderMode("livekit"), "livekit");
});

test("rejects an invalid voice provider instead of silently choosing one", () => {
  assert.throws(() => parseVoiceProviderMode(undefined), /Invalid voice provider/);
});
