import { defineEventHandler, getHeader } from "h3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dbPool } from "../../../db";

const getSecret = () => process.env.AUTH_SECRET || "dev-only-change-this-secret";

const verifySignature = (payload: string, signature: string) => {
  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature || "");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const [payload, signature] = token.split(".");

  if (!payload || !signature || !verifySignature(payload, signature)) {
    return { success: false, message: "جلسة غير صالحة" };
  }

  let userId = "";
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    userId = String(parsed.sub || "");
  } catch {
    return { success: false, message: "توكن غير صالح" };
  }

  try {
    const result = await dbPool.query(
      `SELECT "user_id", "avatar_frame_url", "member_card_bg_url" FROM "user_profiles" WHERE "user_id" = $1 LIMIT 1`,
      [userId]
    );
    return {
      success: true,
      userId,
      profileRow: result.rows[0] || null,
      allUserIds: (await dbPool.query(`SELECT DISTINCT "user_id" FROM "user_profiles" LIMIT 20`)).rows.map(r => r.user_id),
    };
  } catch (e: any) {
    return { success: false, userId, error: e.message };
  }
});
