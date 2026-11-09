import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  AnnouncementDeliveryError,
  listPendingAnnouncements,
} from "../../../services/announcementDelivery";
import type { PendingAnnouncement } from "../../../services/announcementDelivery";
import { getUserAuthContext } from "../../../services/adminAccess";

type ListAnnouncements = (
  userId: string,
  cursor: string | null,
  limit: number,
) => Promise<{ items: PendingAnnouncement[]; nextCursor: string | null }>;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export function createAnnouncementPendingHandler(
  list: ListAnnouncements = listPendingAnnouncements,
) {
  return defineEventHandler(async (event) => {
    const auth = getUserAuthContext(event);
    if (!auth.ok) {
      setResponseStatus(event, auth.statusCode);
      return { success: false, code: "UNAUTHENTICATED", message: auth.message };
    }
    if (!auth.userId || auth.role.toLowerCase() === "guest") {
      setResponseStatus(event, 403);
      return { success: false, code: "MEMBERS_ONLY", message: "الإعلانات متاحة للأعضاء فقط" };
    }

    const query = getQuery(event);
    const cursor = query.cursor === undefined
      ? null
      : typeof query.cursor === "string" && query.cursor.length > 0
        ? query.cursor
        : undefined;
    const limit = query.limit === undefined
      ? DEFAULT_PAGE_SIZE
      : typeof query.limit === "string" && /^\d+$/.test(query.limit)
        ? Number(query.limit)
        : NaN;
    if (
      cursor === undefined ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_PAGE_SIZE
    ) {
      setResponseStatus(event, 422);
      return { success: false, code: "INVALID_REQUEST", message: "مؤشر قائمة الإعلانات غير صالح" };
    }

    try {
      const result = await list(auth.userId, cursor, limit);
      setResponseHeader(event, "Cache-Control", "no-store");
      return { success: true, ...result };
    } catch (error) {
      if (error instanceof AnnouncementDeliveryError && error.code === "INVALID_REQUEST") {
        setResponseStatus(event, 422);
        return { success: false, code: error.code, message: error.message };
      }

      console.error("[Announcements] Failed to list pending announcements:", error);
      setResponseStatus(event, 500);
      return { success: false, code: "INTERNAL_ERROR", message: "تعذر تحميل الإعلانات" };
    }
  });
}

export default createAnnouncementPendingHandler();
