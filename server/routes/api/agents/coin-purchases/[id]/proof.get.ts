import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { dbPool } from "../../../../../db";
import { getPrivateReceiptContentType, readPrivateReceipt } from "../../../../../services/privateReceiptStore";
import { requireWalletAgent } from "../../../../../services/walletAgentAccess";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "Content-Security-Policy", "default-src 'none'; sandbox");
  const agent = await requireWalletAgent(event);
  if (!agent.ok) return { success: false, code: "AGENT_ACCESS_DENIED", message: agent.message };

  try {
    const result = await dbPool.query<{ proof_object_key: string }>(
      `SELECT "proof_object_key"
       FROM "member_coin_purchases"
       WHERE "id" = $1 AND "agent_id" = $2 AND "proof_object_key" IS NOT NULL
         AND "receipt_expires_at" > now()
         AND "status" IN ('submitted', 'approved', 'rejected')
       LIMIT 1`,
      [getRouterParam(event, "id") || "", agent.id],
    );
    const key = result.rows[0]?.proof_object_key;
    if (!key) {
      setResponseStatus(event, 404);
      return { success: false, code: "RECEIPT_NOT_FOUND", message: "الإيصال غير موجود أو انتهت مدة الاحتفاظ به" };
    }
    setResponseHeader(event, "Content-Type", getPrivateReceiptContentType(key));
    setResponseHeader(event, "Content-Disposition", "inline");
    return await readPrivateReceipt(key);
  } catch (error) {
    console.error("[Agent Purchases] Failed to read member receipt:", error);
    setResponseStatus(event, 500);
    return { success: false, code: "RECEIPT_READ_FAILED", message: "تعذر تحميل الإيصال" };
  }
});
