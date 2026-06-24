import { redis, KEYS } from "./redis";

export type DetailedStatus =
  | "active"
  | "idle"
  | "lurking"
  | "passive_watching"
  | "multitasking"
  | "speaking"
  | "focused"
  | "hidden_watching"
  | "online";

export type PresenceSignal = {
  roomId?: string;
  signal?: string;
  tabFocused?: boolean;
  interactionDepth?: number;
  typingFrequency?: number;
  speakingFrequency?: number;
  passiveViewingSeconds?: number;
  hidden?: boolean;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function inferPresenceStatus(signal: PresenceSignal): { status: DetailedStatus; attentionScore: number } {
  const interactionDepth = Number(signal.interactionDepth ?? 0);
  const typing = Number(signal.typingFrequency ?? 0);
  const speaking = Number(signal.speakingFrequency ?? 0);
  const passive = Number(signal.passiveViewingSeconds ?? 0);
  const focused = signal.tabFocused !== false;

  const attentionScore = clampScore(
    (focused ? 35 : 5) +
    interactionDepth * 35 +
    Math.min(15, typing * 3) +
    Math.min(15, speaking * 5) -
    Math.min(25, passive / 12)
  );

  if (signal.hidden) return { status: "hidden_watching", attentionScore };
  if (speaking > 0) return { status: "speaking", attentionScore };
  if (attentionScore >= 75) return { status: "focused", attentionScore };
  if (interactionDepth >= 0.55 || typing > 1) return { status: "active", attentionScore };
  if (!focused && passive > 30) return { status: "multitasking", attentionScore };
  if (passive > 60) return { status: "passive_watching", attentionScore };
  if (attentionScore <= 20) return { status: "lurking", attentionScore };
  return { status: "idle", attentionScore };
}

export const updatePresenceV2 = async (userId: string, signal: PresenceSignal) => {
  const inferred = inferPresenceStatus(signal);
  const state = {
    status: inferred.status,
    roomId: signal.roomId ? String(signal.roomId) : "",
    attentionScore: String(inferred.attentionScore),
    lastSeen: String(Date.now()),
    lastSignal: signal.signal ?? "presence.updated",
  };

  await redis.hset(KEYS.presence(userId), state);
  await redis.expire(KEYS.presence(userId), 600);
  await redis.lpush(KEYS.presenceSignals(userId), JSON.stringify({ ...signal, ...state }));
  await redis.ltrim(KEYS.presenceSignals(userId), 0, 99);
  await redis.expire(KEYS.presenceSignals(userId), 3600);

  const { getIO } = await import("../socket");
  const io = getIO();
  if (io) {
    console.debug("[presence] emitting presence:update", { userId, ...state });
    io.emit("presence:update", { userId, ...state });
    if (state.roomId) {
      io.to(`room:${state.roomId}`).emit("room:presence", { userId, status: state.status, attentionScore: inferred.attentionScore });
    }
  }

  return state;
};

/**
 * تحديث حالة المستخدم مع تحليل السلوك
 */
export const setPresenceState = async (userId: string, state: {
  status: DetailedStatus;
  roomId?: string;
  activity?: string;
}) => {
  const key = KEYS.presence(userId);
  const timestamp = Date.now();

  const presenceData = {
    ...state,
    lastSeen: timestamp,
  };

  await redis.hset(key, presenceData);
  await redis.expire(key, 600); // 10 minutes

  // بث التحديث للمشتركين (الأصدقاء أو أعضاء الغرفة)
  const { getIO } = await import("../socket");
  const io = getIO();
  if (io) {
    io.emit('presence:update', { userId, ...presenceData });
    
    if (state.roomId) {
      io.to(`room:${state.roomId}`).emit('room:presence', { userId, status: state.status });
    }
  }

  return presenceData;
};

/**
 * رصد المستخدمين الخاملين تلقائياً
 */
export const cleanupInactiveUsers = async () => {
  // سيتم تنفيذ هذا عبر Cron Job أو Worker
  // يقوم بفحص الـ TTL في Redis وإرسال أحداث 'offline'
};
