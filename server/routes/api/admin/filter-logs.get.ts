import { defineEventHandler } from "h3";
import { dbPool } from "../../../db";
import { guardAdminAction } from "../../../services/adminPermissions";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  try {
    await guardAdminAction(event, "flter");

    const result = await dbPool.query(
      `SELECT 
        id,
        ip,
        msg,
        topic,
        v,
        "time" as "createdAt",
        target,
        source,
        path as "type"
       FROM histletter
       ORDER BY id DESC
       LIMIT 100`
    );

    return { success: true, logs: result.rows };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
