import { defineEventHandler, setResponseStatus } from "h3";
import { guardAdminAction } from "../../../../services/adminPermissions";
import { getAgentPortalPath } from "../../../../services/agentPortal";

export default defineEventHandler(async (event) => {
  await guardAdminAction(event, "admin_agentwallets");

  const path = getAgentPortalPath();
  if (!path) {
    setResponseStatus(event, 503);
    return {
      success: false,
      code: "AGENT_PORTAL_NOT_CONFIGURED",
      message: "اضبط WALLET_AGENT_PORTAL_KEY لإتاحة رابط دخول الوكلاء",
    };
  }

  return { success: true, path };
});
