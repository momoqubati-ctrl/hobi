import { defineEventHandler, setResponseStatus } from "h3";
import { guardAdminAction } from "../../../services/adminPermissions";
import { getGiftCommissionSettings } from "../../../services/giftCommissionService";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_giftcommission");

  try {
    const settings = await getGiftCommissionSettings();
    return { success: true, settings };
  } catch (error) {
    console.error("[Admin Gift Commission] Fetch error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب إعدادات عمولة الهدايا" };
  }
});
