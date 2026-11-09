import assert from "node:assert/strict";
import test from "node:test";
import { connectLiveKitVoiceRoom } from "../src/lib/livekitVoiceSession";

test("connects to the LiveKit URL and room token returned by the voice API", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  let connection: { url: string; token: string } | undefined;
  const fakeRoom = {
    connect: async (url: string, token: string) => {
      connection = { url, token };
    },
    disconnect: async () => {},
  };

  const room = await connectLiveKitVoiceRoom("room-1", "app-auth-token", {
    createRoom: () => fakeRoom,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        success: true,
        url: "wss://voice.example.com",
        token: "livekit-participant-token",
      }), { status: 200 });
    },
  });

  assert.equal(room, fakeRoom);
  assert.equal(requestUrl, "/api/voice/token");
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { roomId: "room-1" });
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer app-auth-token");
  assert.deepEqual(connection, {
    url: "wss://voice.example.com",
    token: "livekit-participant-token",
  });
});

test("does not connect when the voice API rejects the token request", async () => {
  let connected = false;
  await assert.rejects(
    () => connectLiveKitVoiceRoom("room-1", "app-auth-token", {
      createRoom: () => ({
        connect: async () => {
          connected = true;
        },
        disconnect: async () => {},
      }),
      fetcher: async () => new Response(JSON.stringify({
        success: false,
        message: "يجب الانضمام إلى الغرفة قبل طلب رمز الصوت",
      }), { status: 403 }),
    }),
    /يجب الانضمام إلى الغرفة قبل طلب رمز الصوت/,
  );
  assert.equal(connected, false);
});

test("disconnects a partially connected LiveKit room when connection fails", async () => {
  let disconnected = false;
  const connectionError = new Error("LiveKit signaling failed");

  await assert.rejects(
    () => connectLiveKitVoiceRoom("room-1", "app-auth-token", {
      createRoom: () => ({
        connect: async () => {
          throw connectionError;
        },
        disconnect: async () => {
          disconnected = true;
        },
      }),
      fetcher: async () => new Response(JSON.stringify({
        success: true,
        url: "wss://voice.example.com",
        token: "livekit-participant-token",
      }), { status: 200 }),
    }),
    connectionError,
  );
  assert.equal(disconnected, true);
});
