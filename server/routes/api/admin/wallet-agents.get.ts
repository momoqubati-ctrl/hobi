import { defineEventHandler, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_agentwallets");

  try {
    const result = await dbPool.query(
      `SELECT "id"::text AS "id", "username", "name", "phone", "status",
              "force_password_change" AS "forcePasswordChange",
              "created_at" AS "createdAt"
       FROM "wallet_agents"
       ORDER BY "created_at" DESC, "id"`,
    );
    return { success: true, agents: result.rows };
  } catch (error) {
    console.error("[Admin Wallet Agents] List failed:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب حسابات الوكلاء" };
  }
});
