export type CallState = "idle" | "incoming" | "outgoing" | "active" | "minimized";

export type CallMode = "voice" | "video";

export interface CallUser {
  id: string;
  name: string;
  avatar: string;
  rank?: string;
  verified?: boolean;
  statusText?: string;
}

export type NetworkQuality = "excellent" | "good" | "poor";

export type VisualFilter =
  | "none"
  | "soft-glow"
  | "warm-cinema"
  | "neon"
  | "noir"
  | "vivid-hdr";

export type VirtualBackground =
  | "none"
  | "light-blur"
  | "strong-blur"
  | "gaming-room"
  | "modern-office"
  | "space"
  | "night-nature"
  | "custom";

export interface StudioEffectsConfig {
  filter: VisualFilter;
  filterIntensity: number; // 0 - 100
  background: VirtualBackground;
  customBackgroundUrl?: string;
}

export interface CallLogMessage {
  id: string;
  type: "missed" | "completed" | "rejected" | "busy";
  mode?: CallMode;
  durationSeconds?: number;
  timestamp: string;
  callerId: string;
  callerName: string;
}
