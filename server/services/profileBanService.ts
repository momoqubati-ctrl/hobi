import { dbPool } from "../db";
import { isSystemOwnerUsername } from "./systemOwner";
import { logModerationEvent } from "./powersService";

/**
 * خدمة الحظر الدائم الشامل من البروفايل.
 *
 * عند «حظر نهائي» يجب أن يُسجَّل حظر غير قابل للتجاوز عبر كل المعرفات المتاحة:
 * الاسم + IP + بصمة الجهاز + توقيع الجهاز، بحيث لا يستطيع العضو العودة
 * كزائر أو بإعادة تسجيل الدخول أو بتسجيل عضوية جديدة حتى لو غيّر عنوان IP
 * (حظر الجهاز مستقل عن الـ IP ويفحصه banCheck في كل نقاط الدخول).
 */

export interface BanTargetRow {
  id: string;
  username: string;
  displayName?: string;
  ip?: string | null;
  deviceFingerprint?: string | null;
  deviceSignature?: string | null;
  idreg?: string | null;
  uid?: string | null;
}

export interface PlannedBanRow {
  banType: "name" | "ip" | "device";
  targetName?: string | null;
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
  deviceSignature?: string | null;
  decoderCode?: string;
}

export interface ExistingBanRow {
  banType: string;
  targetName?: string | null;
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
  deviceSignature?: string | null;
}

export interface PermanentBanOutcome {
  banned: boolean;
  deniedReason?: string;
  name?: string;
  ip?: string | null;
  deviceFingerprint?: string | null;
  deviceSignature?: string | null;
  banTypeSummary: string[];
  inserted: number;
  skipped: number;
}

const clean = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const isDuplicate = (existing: ExistingBanRow[], planned: PlannedBanRow): boolean => {
  return existing.some((row) => {
    if (String(row.banType || "").toLowerCase() !== planned.banType) return false;
    if (planned.banType === "name") {
      return String(row.targetName || "").toLowerCase() === String(planned.targetName || "").toLowerCase();
    }
    if (planned.banType === "ip") {
      return String(row.ipAddress || "") === String(planned.ipAddress || "");
    }
    if (planned.banType === "device") {
      return (
        String(row.deviceFingerprint || "") === String(planned.deviceFingerprint || "") &&
        String(row.deviceSignature || "") === String(planned.deviceSignature || "")
      );
    }
    return false;
  });
};

/**
 * بناء خطة سجلات الحظر من صف الهدف (دالة خالصة — قابلة للاختبار).
 */
export const planPermanentBanRows = (
  target: {
    username?: string | null;
    displayName?: string | null;
    ip?: string | null;
    device_fingerprint?: string | null;
    device_signature?: string | null;
    // القبول الشائع في الاستدعاءات الداخلية (صف user من قاعدة البيانات أو كائن BanTargetRow)
    deviceFingerprint?: string | null;
    deviceSignature?: string | null;
  },
): PlannedBanRow[] => {
  const plan: PlannedBanRow[] = [];

  const name = clean(target.username) || clean(target.displayName);
  const ip = clean(target.ip);
  const fingerprint = clean((target as any).device_fingerprint) || clean((target as any).deviceFingerprint);
  const signature = clean((target as any).device_signature) || clean((target as any).deviceSignature);

  if (name) {
    plan.push({ banType: "name", targetName: name });
  }
  if (ip) {
    plan.push({ banType: "ip", targetName: name, ipAddress: ip, decoderCode: ip });
  }
  if (fingerprint || signature) {
    plan.push({
      banType: "device",
      targetName: name,
      deviceFingerprint: fingerprint,
      deviceSignature: signature,
      decoderCode: fingerprint || signature || "",
    });
  }

  return plan;
};

/**
 * حذف الخطة المكررة عن السجلات المفعلة مسبقاً (دالة خالصة — قابلة للاختبار).
 */
export const dedupePlannedBanRows = (
  plan: PlannedBanRow[],
  existing: ExistingBanRow[],
): { rows: PlannedBanRow[]; skipped: number } => {
  const rows = plan.filter((row) => !isDuplicate(existing, row));
  return { rows, skipped: plan.length - rows.length };
};

/**
 * تنفيذ الحظر الدائم الشامل لعضو مع أحد معرفاته (المتصل دائماً للمشرف).
 */
export const applyPermanentSiteBan = async (params: {
  targetProfile: { id?: string; username?: string; displayName?: string };
  actorId: string;
  reason?: string;
  pool?: typeof dbPool;
}): Promise<PermanentBanOutcome> => {
  const pool = params.pool || dbPool;
  const outcome: PermanentBanOutcome = { banned: false, banTypeSummary: [], inserted: 0, skipped: 0 };

  const targetKey = String(params.targetProfile?.id || "").trim();
  const targetUsername = String(params.targetProfile?.username || "").trim();
  if (!targetKey && !targetUsername) {
    return { ...outcome, deniedReason: "العضو المراد حظره غير موجود" };
  }

  // جلب صف الهدف بكل المعرفات المحتملة
  const lookup = await pool.query(
    `SELECT CAST(id AS text) AS id,
            username,
            topic AS display_name,
            ip,
            fp AS device_fingerprint,
            device_signature,
            idreg,
            uid
       FROM users
      WHERE CAST(id AS text) = $1
         OR CAST(uid AS text) = $1
         OR CAST(idreg AS varchar) = $1
         OR lower(username) = lower($1)
      ORDER BY CASE WHEN CAST(id AS text) = $1 THEN 0
                    WHEN CAST(uid AS text) = $1 THEN 1
                    ELSE 2 END
      LIMIT 1`,
    [targetKey || targetUsername],
  );

  const row = lookup.rows[0];
  if (!row?.id) {
    return { ...outcome, deniedReason: "لم يتم العثور على سجل العضو في قاعدة البيانات" };
  }
  if (isSystemOwnerUsername(String(row.username || ""))) {
    return { ...outcome, deniedReason: "لا يمكن حظر مالك الموقع" };
  }

  const target: BanTargetRow = {
    id: String(row.id),
    username: String(row.username || ""),
    displayName: String(row.display_name || ""),
    ip: row.ip,
    deviceFingerprint: row.device_fingerprint,
    deviceSignature: row.device_signature,
    idreg: row.idreg,
    uid: row.uid,
  };

  // المنع من التكرار: السجلات المفعلة المطابقة أولاً
  let existingRows: ExistingBanRow[] = [];
  try {
    const existing = await pool.query(
      `SELECT ban_type, target_name, ip_address, device_fingerprint, device_signature
         FROM moderation_bans
        WHERE is_active = true
          AND (
            (ban_type = 'name' AND target_name IS NOT NULL AND lower(target_name) = lower($1))
            OR (ban_type = 'ip' AND ip_address IS NOT DISTINCT FROM $2 AND $2 IS NOT NULL)
            OR (ban_type = 'device' AND (
                  (device_fingerprint IS NOT DISTINCT FROM $3 AND $3 IS NOT NULL)
               OR (device_signature IS NOT DISTINCT FROM $4 AND $4 IS NOT NULL)
               ))
          )`,
      [target.username, clean(target.ip), clean(target.deviceFingerprint), clean(target.deviceSignature)],
    );
    existingRows = existing.rows.map((r) => ({
      banType: String(r.ban_type || ""),
      targetName: r.target_name,
      ipAddress: r.ip_address,
      deviceFingerprint: r.device_fingerprint,
      deviceSignature: r.device_signature,
    }));
  } catch (err) {
    console.error("[SiteBan] duplicate lookup failed, proceeding without dedupe:", err);
  }

  const fullPlan = planPermanentBanRows(target);
  const { rows: plan, skipped } = dedupePlannedBanRows(fullPlan, existingRows);
  outcome.skipped = skipped;
  const reason = String(params.reason || "حظر نهائي من البروفايل").slice(0, 500);
  const reasonLabel = "دائم";
  let inserted = 0;

  for (const planned of plan) {
    try {
      await pool.query(
        `INSERT INTO moderation_bans
           (target_name, ban_type, decoder_code, ip_address, device_fingerprint, device_signature,
            expires_at, expires_label, reason, created_by, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, true)`,
        [
          planned.targetName || null,
          planned.banType,
          planned.decoderCode || "",
          planned.ipAddress || null,
          planned.deviceFingerprint || null,
          planned.deviceSignature || null,
          reasonLabel,
          reason,
          clean(params.actorId),
        ],
      );
      inserted++;
      outcome.banTypeSummary.push(
        planned.banType === "name" ? "الاسم" : planned.banType === "ip" ? "IP" : "بصمة الجهاز",
      );
    } catch (err) {
      console.error(`[SiteBan] failed to insert ban (${planned.banType}):`, err);
    }
  }

  outcome.inserted = inserted;
  outcome.name = target.username;
  outcome.ip = clean(target.ip);
  outcome.deviceFingerprint = clean(target.deviceFingerprint);
  outcome.deviceSignature = clean(target.deviceSignature);
  outcome.banned = inserted > 0;

  try {
    await logModerationEvent({
      actorId: clean(params.actorId) || undefined,
      targetUserId: target.id,
      eventType: "site_ban.permanent",
      reason,
      metadata: {
        banTypes: plan.map((p) => p.banType),
        inserted,
        ip: outcome.ip,
        deviceFingerprint: outcome.deviceFingerprint,
        deviceSignature: outcome.deviceSignature,
      },
    });
  } catch (err) {
    console.error("[SiteBan] moderation event logging failed:", err);
  }

  return outcome;
};
