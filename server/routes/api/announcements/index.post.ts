import {
  defineEventHandler,
  getHeader,
  readBody,
  setResponseStatus,
} from "h3";
import {
  AnnouncementDeliveryError,
  sendAnnouncement,
} from "../../../services/announcementDelivery";
import type {
  AnnouncementReceipt,
  SendAnnouncementInput,
} from "../../../services/announcementDelivery";
import { getUserAuthContext } from "../../../services/adminAccess";

type SendAnnouncement = (
  input: SendAnnouncementInput,
) => Promise<AnnouncementReceipt>;
type AnnouncementBody =
  | { type: "all" | "ranked"; message: string }
  | { type: "room"; message: string; roomId: string };

const isAnnouncementBody = (
  body: unknown,
): body is AnnouncementBody => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const allowedKeys = new Set(["type", "message", "roomId"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return false;
  if (typeof body.type !== "string" || typeof body.message !== "string") return false;
  if (body.type === "room") return typeof body.roomId === "string";
  return (body.type === "all" || body.type === "ranked") && body.roomId === undefined;
};

function getErrorResponse(error: AnnouncementDeliveryError): {
  status: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case "INVALID_REQUEST":
      return { status: 422, code: error.code, message: "بيانات الإعلان غير صالحة" };
    case "NOT_ALLOWED":
      return { status: 403, code: error.code, message: "لا تملك صلاحية هذا النوع من الإعلانات" };
    case "ROOM_NOT_FOUND":
      return { status: 404, code: error.code, message: "الغرفة غير موجودة" };
    case "DAILY_LIMIT_EXCEEDED":
      return { status: 429, code: error.code, message: "تجاوزت الحد اليومي لإرسال الإعلانات" };
    case "IDEMPOTENCY_CONFLICT":
      return { status: 409, code: error.code, message: "تعذر تكرار طلب الإرسال" };
    case "IDEMPOTENCY_INCONSISTENT":
    case "SENDER_NOT_FOUND":
      return { status: 500, code: "INTERNAL_ERROR", message: "تعذر إرسال الإعلان" };
  }
}

export function createAnnouncementSendHandler(
  send: SendAnnouncement = sendAnnouncement,
) {
  return defineEventHandler(async (event) => {
    const auth = getUserAuthContext(event);
    if (!auth.ok) {
      setResponseStatus(event, auth.statusCode);
      return { success: false, code: "UNAUTHENTICATED", message: auth.message };
    }
    if (!auth.userId || auth.role.toLowerCase() === "guest") {
      setResponseStatus(event, 403);
      return { success: false, code: "MEMBERS_ONLY", message: "إرسال الإعلانات متاح للأعضاء فقط" };
    }

    const body = await readBody<unknown>(event);
    const idempotencyKey = getHeader(event, "idempotency-key");
    if (!isAnnouncementBody(body) || !idempotencyKey) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_REQUEST", message: "بيانات الإعلان ومفتاح الإرسال مطلوبة" };
    }

    try {
      const result = await send({
        senderUserId: auth.userId,
        senderUsername: auth.username,
        type: body.type,
        message: body.message,
        idempotencyKey,
        ...(body.type === "room" ? { roomId: body.roomId } : {}),
      });
      setResponseStatus(event, 201);
      return { success: true, ...result };
    } catch (error) {
      if (error instanceof AnnouncementDeliveryError) {
        const response = getErrorResponse(error);
        setResponseStatus(event, response.status);
        if (response.status === 500) console.error("[Announcements] Send request failed:", error);
        return { success: false, code: response.code, message: response.message };
      }

      console.error("[Announcements] Send request failed:", error);
      setResponseStatus(event, 500);
      return { success: false, code: "INTERNAL_ERROR", message: "تعذر إرسال الإعلان" };
    }
  });
}

export default createAnnouncementSendHandler();
