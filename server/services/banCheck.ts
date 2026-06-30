import { dbPool } from "../db";

export interface BanCheckParams {
  username?: string;
  ip?: string;
  deviceFingerprint?: string;
  deviceSignature?: string;
}

export interface BanCheckResult {
  banned: boolean;
  bans: Array<{
    id: number;
    targetName: string;
    banType: string;
    decoderCode: string;
    expiresAt: string | null;
    expiresLabel: string;
    reason: string | null;
  }>;
}

export async function checkBan(options: BanCheckParams): Promise<BanCheckResult> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (options.username) {
    conditions.push(`(ban_type = 'name' AND LOWER(target_name) = LOWER($${paramIndex}))`);
    params.push(options.username);
    paramIndex++;
  }

  if (options.ip) {
    conditions.push(`(ban_type = 'ip' AND ip_address = $${paramIndex})`);
    params.push(options.ip);
    paramIndex++;
  }

  if (options.deviceFingerprint) {
    conditions.push(`(ban_type = 'device' AND device_fingerprint = $${paramIndex})`);
    params.push(options.deviceFingerprint);
    paramIndex++;
  }

  if (options.deviceSignature) {
    conditions.push(`(ban_type = 'device' AND device_signature = $${paramIndex})`);
    params.push(options.deviceSignature);
    paramIndex++;
  }

  if (conditions.length === 0) {
    return { banned: false, bans: [] };
  }

  const whereClause = conditions.join(" OR ");

  try {
    const result = await dbPool.query(
      `SELECT id, target_name, ban_type, decoder_code, expires_at, expires_label, reason
       FROM moderation_bans
       WHERE is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (${whereClause})
       ORDER BY created_at DESC`,
      params,
    );

    return {
      banned: result.rows.length > 0,
      bans: result.rows.map((r: any) => ({
        id: r.id,
        targetName: r.target_name,
        banType: r.ban_type,
        decoderCode: r.decoder_code,
        expiresAt: r.expires_at,
        expiresLabel: r.expires_label,
        reason: r.reason,
      })),
    };
  } catch (error) {
    console.error("[banCheck] Error checking ban:", error);
    return { banned: false, bans: [] };
  }
}
