import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";

export interface BridgedPresenceUser {
  id: string;
  role: string;
  roomId: string;
}

const PRESENCE_BRIDGE_HEADER = "x-internal-presence-token";
const PRESENCE_BRIDGE_SCOPE = "vite-presence-bridge:v1";
const MAX_BRIDGE_RESPONSE_BYTES = 1_000_000;

export function getPresenceBridgeToken(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be configured for the Vite presence bridge");
  return createHmac("sha256", secret).update(PRESENCE_BRIDGE_SCOPE).digest("base64url");
}

export function isPresenceBridgeAuthorized(token: string | undefined): boolean {
  if (!token || !process.env.AUTH_SECRET) return false;
  const expected = Buffer.from(getPresenceBridgeToken());
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isBridgedPresenceUser(value: unknown): value is BridgedPresenceUser {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "role" in value &&
    typeof value.role === "string" &&
    "roomId" in value &&
    typeof value.roomId === "string";
}

function requestViteBridge(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const token = getPresenceBridgeToken();

  class ViteBridgeResponseError extends Error {}

  const requestWith = (
    transport: typeof http | typeof https,
    secure: boolean,
  ): Promise<unknown> => new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: "127.0.0.1",
      port: 3000,
      path,
      method: serializedBody === undefined ? "GET" : "POST",
      ...(secure ? { rejectUnauthorized: false } : {}),
      headers: {
        [PRESENCE_BRIDGE_HEADER]: token,
        ...(serializedBody === undefined
          ? {}
          : {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(serializedBody),
          }),
      },
      timeout: 2000,
    }, (response) => {
      let responseBody = "";
      response.on("data", (chunk: Buffer | string) => {
        responseBody += chunk.toString();
        if (Buffer.byteLength(responseBody) > MAX_BRIDGE_RESPONSE_BYTES) {
          request.destroy(new Error("Vite presence bridge response exceeded the size limit"));
        }
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new ViteBridgeResponseError(
            `Vite presence bridge returned HTTP ${response.statusCode ?? "unknown"}`,
          ));
          return;
        }
        try {
          resolve(JSON.parse(responseBody) as unknown);
        } catch {
          reject(new Error("Vite presence bridge returned invalid JSON"));
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Vite presence bridge request timed out"));
    });
    request.on("error", reject);
    if (serializedBody !== undefined) request.write(serializedBody);
    request.end();
  });

  return requestWith(https, true).catch((httpsError: unknown) => {
    if (httpsError instanceof ViteBridgeResponseError) throw httpsError;
    return requestWith(http, false).catch((httpError: unknown) => {
      if (httpError instanceof ViteBridgeResponseError) throw httpError;
      throw new AggregateError([httpsError, httpError], "Unable to reach the Vite presence bridge");
    });
  });
}

export async function fetchVitePresenceUsers(): Promise<BridgedPresenceUser[]> {
  const result = await requestViteBridge("/__presence_users__");
  if (!Array.isArray(result) || !result.every(isBridgedPresenceUser)) {
    throw new Error("Vite presence bridge returned an invalid user list");
  }
  return result;
}

export async function publishViteUserEvent(input: {
  userId: string;
  event: string;
  payload: unknown;
  excludeSocketId?: string;
}): Promise<void> {
  const result = await requestViteBridge("/__publish_user_event__", input);
  if (
    typeof result !== "object" ||
    result === null ||
    !("success" in result) ||
    result.success !== true ||
    !("emittedTo" in result) ||
    typeof result.emittedTo !== "number" ||
    result.emittedTo < 1
  ) {
    throw new Error("Vite presence bridge did not find an online recipient socket");
  }
}
