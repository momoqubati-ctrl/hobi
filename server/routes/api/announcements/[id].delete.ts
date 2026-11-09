import {
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
} from "h3";
import {
  AnnouncementDeliveryError,
  dismissAnnouncement,
} from "../../../services/announcementDelivery";
import { getUserAuthContext } from "../../../services/adminAccess";

type DismissAnnouncement = (userId: string, announcementId: string) => Promise<void>;

export function createAnnouncementDismissHandler(
  dismiss: DismissAnnouncement = dismissAnnouncement,
) {
  return defineEventHandler(async (event) => {
    const auth = getUserAuthContext(event);
    if (!auth.ok) {
      setResponseStatus(event, auth.statusCode);
      return { success: false, code: "UNAUTHENTICATED", message: auth.message };
    }
    if (!auth.userId || auth.role.toLowerCase() === "guest") {
      setResponseStatus(event, 403);
      return { success: false, code: "MEMBERS_ONLY", message: "إغلاق الإعلانات متاح للأعضاء فقط" };
    }

    const announcementId = getRouterParam(event, "id");
    try {
      if (!announcementId) {
        throw new AnnouncementDeliveryError("INVALID_REQUEST", "معرف الإعلان مطلوب");
      }
      await dismiss(auth.userId, announcementId);
      return { success: true };
    } catch (error) {
      if (error instanceof AnnouncementDeliveryError && error.code === "INVALID_REQUEST") {
        setResponseStatus(event, 422);
        return { success: false, code: error.code, message: error.message };
      }

      console.error("[Announcements] Failed to dismiss announcement:", error);
      setResponseStatus(event, 500);
      return { success: false, code: "INTERNAL_ERROR", message: "تعذر إغلاق الإعلان" };
    }
  });
}

export default createAnnouncementDismissHandler();
