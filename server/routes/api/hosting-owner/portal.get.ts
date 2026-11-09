import {
  defineEventHandler,
  getRequestHeader,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import {
  getHostingOwnerPortalPath,
  isValidHostingOwnerPortalKey,
} from "../../../services/hostingOwnerPortal";

export default defineEventHandler(async (event) => {
  if (!getHostingOwnerPortalPath()) {
    setResponseStatus(event, 503);
    return {
      success: false,
      code: "HOSTING_OWNER_PORTAL_NOT_CONFIGURED",
      message: "بوابة مالك الاستضافة غير مهيأة",
    };
  }
  if (!isValidHostingOwnerPortalKey(getRequestHeader(event, "x-hosting-owner-portal-key"))) {
    setResponseStatus(event, 404);
    return {
      success: false,
      code: "HOSTING_OWNER_PORTAL_NOT_FOUND",
      message: "الصفحة غير موجودة",
    };
  }

  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  return { success: true };
});
