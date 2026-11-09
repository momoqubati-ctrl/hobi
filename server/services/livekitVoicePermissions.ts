import {
  RoomServiceClient,
  TrackSource,
  TrackType,
  type ParticipantPermission,
} from "livekit-server-sdk";
import { createVoiceProviderStore, type VoiceProviderRuntimeConfig } from "./voiceProviderStore";

type LiveKitAdminClient = Pick<
  RoomServiceClient,
  "listParticipants" | "updateParticipant" | "mutePublishedTrack" | "removeParticipant"
>;
type LiveKitReconciliationClient = LiveKitAdminClient & Pick<RoomServiceClient, "listRooms">;
type LiveKitRoomManagementClient = Pick<RoomServiceClient, "listRooms" | "createRoom">;

type LiveKitEnvironment = {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  NODE_ENV?: string;
};

export function createLiveKitRoomServiceClient(
  env: LiveKitEnvironment = process.env,
): RoomServiceClient | null {
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  const livekitUrl = env.LIVEKIT_URL?.trim();
  if (!apiKey || !apiSecret || !livekitUrl) return null;

  if (
    apiKey === "devkey" ||
    apiSecret.length < 32 ||
    apiSecret === "secret_which_needs_to_be_at_least_32_characters_long_for_security"
  ) {
    throw new Error("LiveKit Room Service credentials are not securely configured");
  }

  let url: URL;
  try {
    url = new URL(livekitUrl);
  } catch {
    throw new Error("LiveKit URL is invalid");
  }
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    (env.NODE_ENV === "production" && url.protocol !== "wss:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("LiveKit URL is invalid");
  }
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";

  return new RoomServiceClient(url.toString().replace(/\/$/, ""), apiKey, apiSecret);
}

export async function createConfiguredLiveKitRoomServiceClient(
  loadRuntimeConfig: () => Promise<VoiceProviderRuntimeConfig | null> = () =>
    createVoiceProviderStore().getRuntimeConfig(),
): Promise<RoomServiceClient | null> {
  const config = await loadRuntimeConfig();
  if (!config) return null;

  return createLiveKitRoomServiceClient({
    LIVEKIT_URL: config.url,
    LIVEKIT_API_KEY: config.apiKey,
    LIVEKIT_API_SECRET: config.apiSecret,
    NODE_ENV: process.env.NODE_ENV,
  });
}

export async function ensureLiveKitRoomExists(
  client: LiveKitRoomManagementClient,
  roomId: string,
): Promise<void> {
  const rooms = await client.listRooms([roomId]);
  if (rooms.some((room) => room.name === roomId)) return;

  try {
    await client.createRoom({ name: roomId });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "already_exists"
    ) {
      return;
    }
    throw error;
  }
}

export async function ensureConfiguredLiveKitRoom(roomId: string): Promise<void> {
  const client = await createConfiguredLiveKitRoomServiceClient();
  if (!client) return;
  await ensureLiveKitRoomExists(client, roomId);
}

export async function disconnectLiveKitParticipant(
  client: Pick<RoomServiceClient, "removeParticipant">,
  roomId: string,
  identity: string,
): Promise<boolean> {
  try {
    await client.removeParticipant(roomId, identity, {
      revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1),
    });
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "not_found"
    ) {
      return false;
    }
    throw error;
  }
}

export async function disconnectConfiguredLiveKitParticipant(
  roomId: string,
  identity: string,
  loadRuntimeConfig: () => Promise<VoiceProviderRuntimeConfig | null> = () =>
    createVoiceProviderStore().getRuntimeConfig(),
): Promise<boolean> {
  const client = await createConfiguredLiveKitRoomServiceClient(loadRuntimeConfig);
  if (!client) return false;
  return disconnectLiveKitParticipant(client, roomId, identity);
}

async function disconnectParticipant(
  client: LiveKitAdminClient,
  roomId: string,
  identity: string,
): Promise<void> {
  try {
    await client.removeParticipant(roomId, identity, {
      revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1),
    });
  } catch (error) {
    console.error("[LiveKit] Failed to disconnect participant after permission sync failure", {
      roomId,
      identity,
      error,
    });
    throw new Error("تعذر سحب صلاحية نشر الصوت أو فصل المشارك");
  }
}

async function syncParticipantPublishPermission(
  client: LiveKitAdminClient,
  roomId: string,
  participant: Awaited<ReturnType<RoomServiceClient["listParticipants"]>>[number],
  canPublish: boolean,
): Promise<void> {
  const { identity } = participant;

  const permission: ParticipantPermission = {
    canSubscribe: participant.permission?.canSubscribe ?? true,
    canPublish,
    canPublishData: false,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    hidden: participant.permission?.hidden ?? false,
    recorder: participant.permission?.recorder ?? false,
    canUpdateMetadata: participant.permission?.canUpdateMetadata ?? false,
    agent: participant.permission?.agent ?? false,
    canSubscribeMetrics: participant.permission?.canSubscribeMetrics ?? false,
    canManageAgentSession: participant.permission?.canManageAgentSession ?? false,
  };

  try {
    await client.updateParticipant(roomId, identity, { permission });
  } catch (error) {
    console.error("[LiveKit] Failed to update participant publish permission", {
      roomId,
      identity,
      error,
    });
    if (canPublish) throw new Error("تعذر تحديث صلاحية نشر الصوت");
    await disconnectParticipant(client, roomId, identity);
    return;
  }

  if (canPublish) return;

  try {
    await Promise.all(
      participant.tracks
        .filter((track) => track.type === TrackType.AUDIO && !track.muted)
        .map((track) => client.mutePublishedTrack(roomId, identity, track.sid, true)),
    );
  } catch (error) {
    console.error("[LiveKit] Failed to mute a published audio track after permission revocation", {
      roomId,
      identity,
      error,
    });
    await disconnectParticipant(client, roomId, identity);
  }
}

export async function syncLiveKitPublishPermission(
  client: LiveKitAdminClient,
  roomId: string,
  identity: string,
  canPublish: boolean,
): Promise<void> {
  const participant = (await client.listParticipants(roomId)).find(
    (entry) => entry.identity === identity,
  );
  if (participant) {
    await syncParticipantPublishPermission(client, roomId, participant, canPublish);
  }
}

export async function reconcileLiveKitPublishPermissions(
  client: LiveKitReconciliationClient,
  activePublisherKeys: ReadonlySet<string>,
): Promise<void> {
  for (const room of await client.listRooms()) {
    const participants = await client.listParticipants(room.name);
    for (const participant of participants) {
      const expectedCanPublish = activePublisherKeys.has(
        `${room.name}\u0000${participant.identity}`,
      );
      const permission = participant.permission;
      const hasMicrophonePermission = permission?.canPublishSources.includes(
        TrackSource.MICROPHONE,
      );
      const needsSync = expectedCanPublish
        ? !permission?.canPublish ||
          permission.canPublishData ||
          !hasMicrophonePermission
        : Boolean(permission?.canPublish || permission?.canPublishData || participant.isPublisher);
      if (needsSync) {
        await syncParticipantPublishPermission(
          client,
          room.name,
          participant,
          expectedCanPublish,
        );
      }
    }
  }
}

export async function syncConfiguredLiveKitPublishPermission(
  roomId: string,
  identity: string,
  canPublish: boolean,
): Promise<void> {
  const client = await createConfiguredLiveKitRoomServiceClient();
  if (!client) return;
  await syncLiveKitPublishPermission(client, roomId, identity, canPublish);
}

export async function reconcileConfiguredLiveKitPublishPermissions(
  activePublisherKeys: ReadonlySet<string>,
): Promise<void> {
  const client = await createConfiguredLiveKitRoomServiceClient();
  if (!client) return;
  await reconcileLiveKitPublishPermissions(client, activePublisherKeys);
}
