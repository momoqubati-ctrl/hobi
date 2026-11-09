export type VoiceProviderMode = "webrtc" | "livekit";

export function parseVoiceProviderMode(value: unknown): VoiceProviderMode {
  if (value === "webrtc" || value === "livekit") return value;
  throw new Error("Invalid voice provider returned by the server");
}
