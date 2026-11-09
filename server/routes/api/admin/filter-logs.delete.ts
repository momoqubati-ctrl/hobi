import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "flter");

    await dbPool.query("TRUNCATE TABLE histletter");

    await logAdminAudit({
      actorId: admin.userId,
      action: "filter.logs.clear",
      targetType: "system",
      targetId: "histletter"
    });

    return { success: true, message: "تم تفريغ سجل الرصد بنجاح" };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
