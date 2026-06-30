import { defineEventHandler, readBody } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction, logAdminAudit } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  try {
    const admin = await guardAdminAction(event, "ban");
    const body = await readBody(event);

    const { targetName, type, value, ip, deviceFingerprint, deviceSignature, countryCode, reason, expiresAt, expiresLabel } = body;

    if (!targetName || !type) {
      throw new Error("البيانات المطلوبة ناقصة");
    }

    const adminId = await dbPool.query(
      `SELECT id FROM users WHERE idreg::text = $1 OR id::text = $1 OR uid::text = $1 LIMIT 1`,
      [String(admin.userId)],
    );
    const createdBy = adminId.rows[0]?.id || null;

    const result = await dbPool.query(
      `INSERT INTO moderation_bans
        (target_name, ban_type, decoder_code, ip_address, device_fingerprint, device_signature, country_code, expires_at, expires_label, reason, created_by, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       RETURNING id`,
      [
        targetName,
        type,
        value || "",
        ip || null,
        deviceFingerprint || null,
        deviceSignature || null,
        countryCode || null,
        expiresAt || null,
        expiresLabel || "دائم",
        reason || null,
        createdBy,
      ],
    );

    await logAdminAudit({
      actorId: admin.userId,
      action: "ban.create",
      targetType: "user",
      targetId: targetName,
      metadata: { type, value, ip, reason },
    });

    return { success: true, message: "تم الحظر بنجاح", banId: result.rows[0].id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
});