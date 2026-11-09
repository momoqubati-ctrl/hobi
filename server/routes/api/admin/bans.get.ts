import { defineEventHandler, getQuery } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    await guardAdminAction(event, "ban");

    const query = getQuery(event);
    const activeOnly = query.active === "true";

    let where = "";
    if (activeOnly) {
      where = "WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())";
    }

    const result = await dbPool.query(
      `SELECT 
        id,
        target_name as "targetName",
        ban_type as "type",
        decoder_code as "value",
        ip_address as "ip",
        device_fingerprint as "fingerprint",
        device_signature as "deviceSignature",
        reason,
        country_code as "country",
        expires_label as "duration",
        expires_at as "expiresAt",
        is_active as "isActive",
        created_at as "createdAt",
        (SELECT topic FROM users WHERE id = created_by) as "createdBy"
       FROM moderation_bans
       ${where}
       ORDER BY created_at DESC`
    );

    return { success: true, bans: result.rows };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
