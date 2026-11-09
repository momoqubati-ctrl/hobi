import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { guardAdminAction } from "../../../services/adminPermissions";
import {
  GiftCommissionInputError,
  updateGiftCommissionSettings,
} from "../../../services/giftCommissionService";

export default defineEventHandler(async (event) => {
  const admin = await guardAdminAction(event, "admin_giftcommission");
  const body = await readBody<{ commissionRatePercent?: unknown } | null>(event);

  try {
    const settings = await updateGiftCommissionSettings(body?.commissionRatePercent, admin.userId);
    return { success: true, settings };
  } catch (error) {
    if (error instanceof GiftCommissionInputError) {
      setResponseStatus(event, 422);
      return { success: false, message: error.message };
    }

    console.error("[Admin Gift Commission] Update error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر حفظ إعدادات عمولة الهدايا" };
  }
});
