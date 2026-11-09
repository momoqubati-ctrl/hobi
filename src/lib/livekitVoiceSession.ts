export interface LiveKitRoomConnection {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}

interface VoiceTokenResponse {
  success: true;
  url: string;
  token: string;
}

function isVoiceTokenResponse(value: unknown): value is VoiceTokenResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return response.success === true &&
    typeof response.url === "string" &&
    typeof response.token === "string";
}

export async function connectLiveKitVoiceRoom<T extends LiveKitRoomConnection>(
  roomId: string,
  authToken: string,
  options: {
    createRoom: () => T;
    fetcher?: typeof fetch;
  },
): Promise<T> {
  const response = await (options.fetcher || fetch)("/api/voice/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ roomId }),
  });
  const payload: unknown = await response.json();

  if (!response.ok || !isVoiceTokenResponse(payload)) {
    const message =
      payload && typeof payload === "object" && "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `تعذر الحصول على رمز الصوت (${response.status})`;
    throw new Error(message);
  }

  const room = options.createRoom();
  try {
    await room.connect(payload.url, payload.token);
    return room;
  } catch (error) {
    try {
      await room.disconnect();
    } catch (cleanupError) {
      console.error("[LiveKit] Failed to clean up after a connection error", cleanupError);
    }
    throw error;
  }
}
