import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "owner");

    await dbPool.query("TRUNCATE TABLE logs");

    await logAdminAudit({
      actorId: admin.userId,
      action: "logs.clear",
      targetType: "system",
      targetId: "access_logs",
      metadata: { type: "manual_clear" }
    });

    return { success: true, message: "تم مسح السجل بالكامل بنجاح" };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
