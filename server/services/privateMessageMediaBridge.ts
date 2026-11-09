/**
 * جسر وسائط الرسائل الخاصة بين سياق Nitro (مسارات REST) وسياق Vite الرئيسي
 * (حيث يعمل Socket.io ومتجر الرسائل الخاصة المؤقتة).
 *
 * في وضع التطوير (vite + nitro()) يتم تنفيذ مسارات server/routes داخل عامل Nitro
 * المنفصل، بينما يعيش متجر الرسائل الخاص المؤقت في العملية الرئيسية لـ Vite.
 * لذلك يجب إرسال الوسائط المؤقتة واسترجاعها عبر هذا الجسر الداخلي (نفس نمط
 * جسر الحضور في server/socket/presenceBridge.ts).
 */
import http from "node:http";
import https from "node:https";
import { getPresenceBridgeToken } from "../socket/presenceBridge";

const VITE_BRIDGE_HOST = "127.0.0.1";
const VITE_BRIDGE_PORT = Number(process.env.PORT) || 3000;
const MAX_BRIDGE_MEDIA_BYTES = 64 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 10_000;

const PRESENCE_BRIDGE_HEADER = "x-internal-presence-token";

export type BridgeStageResult =
  | { bridged: true; mediaId: string }
  | { bridged: true; mediaId: null; message: string }
  | { bridged: false };

export type BridgeMediaResult =
  | { bridged: true; media: { bytes: Buffer; contentType: string } }
  | { bridged: true; media: null }
  | { bridged: false };

type RawBridgeResponse = {
  status: number;
  contentType: string;
  body: Buffer;
};

const parseBridgeJson = (body: Buffer): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

function requestViteBridgeRaw(
  path: string,
  method: "GET" | "POST",
  body: Buffer | undefined,
  headers: Record<string, string>,
): Promise<RawBridgeResponse> {
  const token = getPresenceBridgeToken();

  class ViteBridgeTransportError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ViteBridgeTransportError";
    }
  }

  const requestWith = (
    transport: typeof http | typeof https,
    secure: boolean,
  ): Promise<RawBridgeResponse> => new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: VITE_BRIDGE_HOST,
      port: VITE_BRIDGE_PORT,
      path,
      method,
      ...(secure ? { rejectUnauthorized: false } : {}),
      headers: {
        [PRESENCE_BRIDGE_HEADER]: token,
        ...(body === undefined ? {} : {
          "content-type": "application/octet-stream",
          "content-length": body.length,
        }),
        ...headers,
      },
      timeout: BRIDGE_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BRIDGE_MEDIA_BYTES) {
          request.destroy(new Error("Vite bridge response exceeded the media size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode || 0,
          contentType: String(response.headers["content-type"] || ""),
          body: Buffer.concat(chunks),
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new ViteBridgeTransportError("Vite bridge request timed out"));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });

  return requestWith(https, true).catch((httpsError: unknown) => {
    if (httpsError instanceof ViteBridgeTransportError) throw httpsError;
    return requestWith(http, false).catch((httpError: unknown) => {
      throw new AggregateError([httpsError, httpError], "Unable to reach the Vite bridge");
    });
  });
}

/**
 * إرسال الوسيط المؤقت عبر الجسر إلى متجر الرسائل الخاص في العملية الرئيسية.
 * أولّد النتيجة:
 *  - { bridged: true, mediaId } نجاح
 *  - { bridged: true, mediaId: null, message } وصل الطلب للعملية الرئيسية ورفضته
 *  - { bridged: false } الجسر غير متاح (لرجوعنا للتنفيذ المحلي)
 */
export async function stagePrivateMediaViaBridge(input: {
  sessionId: string;
  sessionExpiresAt: number;
  userId: string;
  receiverId: string;
  contentType: string;
  mediaType: "image" | "video" | "audio" | "file";
  bytes: Buffer;
}): Promise<BridgeStageResult> {
  let response: RawBridgeResponse;
  try {
    response = await requestViteBridgeRaw("/__pm_stage_media__", "POST", input.bytes, {
      "x-pm-session-id": input.sessionId,
      "x-pm-session-expires-at": String(input.sessionExpiresAt),
      "x-pm-user-id": input.userId,
      "x-pm-recipient-id": input.receiverId,
      "x-pm-content-type": input.contentType,
      "x-pm-media-type": input.mediaType,
    });
  } catch {
    return { bridged: false };
  }

  if (response.status === 200) {
    const parsed = parseBridgeJson(response.body);
    if (parsed?.bridge !== "pm-media") return { bridged: false };
    if (parsed.success === true && typeof parsed.mediaId === "string" && parsed.mediaId) {
      return { bridged: true, mediaId: parsed.mediaId };
    }
    return {
      bridged: true,
      mediaId: null,
      message: typeof parsed.message === "string" ? parsed.message : "تعذر إرسال الوسيط؛ يرجى التحقق من الملف وحالة الاتصال والمحاولة مرة أخرى",
    };
  }

  // رموز الأخطاء تُعتبر رفضًا حاسمًا من العملية الرئيسية فقط إذا كانت
  // استجابة جسر رسمية (بعلامة bridge: "pm-media")؛ يسقط 404 من خوادم
  // أخرى (مثل خادم الإنتاج أحادي العملية) تلقائيًا إلى التنفيذ المحلي.
  if ([400, 401, 409, 413, 500].includes(response.status)) {
    const parsed = parseBridgeJson(response.body);
    if (parsed?.bridge !== "pm-media") return { bridged: false };
    return {
      bridged: true,
      mediaId: null,
      message: typeof parsed.message === "string"
        ? parsed.message
        : "تعذر إرسال الوسيط؛ يرجى التحقق من الملف وحالة الاتصال والمحاولة مرة أخرى",
    };
  }

  // 5xx بدون علامة أو 404 أو رموز غير معروفة: الجسر غير متاح ليتحمل التنفيذ المحلي المهمة
  return { bridged: false };
}

/**
 * استرجاع وسيط من متجر الرسائل الخاص في العملية الرئيسية عبر الجسر.
 */
export async function fetchPrivateMediaViaBridge(
  sessionId: string,
  mediaId: string,
): Promise<BridgeMediaResult> {
  let response: RawBridgeResponse;
  try {
    response = await requestViteBridgeRaw(`/__pm_media__/${encodeURIComponent(mediaId)}`, "GET", undefined, {
      "x-pm-session-id": sessionId,
    });
  } catch {
    return { bridged: false };
  }

  if (response.status === 404) {
    // 404 اصطناعي من جسر رسمي يعني "الوسيط غير موجود" بينما 404 من خوادم
    // أخرى (مثل خادم الإنتاج أحادي العملية) يعني أن الجسر غير متاح.
    const parsed = parseBridgeJson(response.body);
    if (parsed?.bridge === "pm-media") return { bridged: true, media: null };
    return { bridged: false };
  }
  if (response.status !== 200) {
    return { bridged: false };
  }
  return {
    bridged: true,
    media: { bytes: response.body, contentType: response.contentType },
  };
}
