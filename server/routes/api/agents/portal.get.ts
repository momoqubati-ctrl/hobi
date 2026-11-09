import { defineEventHandler, getRequestHeader, setResponseStatus } from "h3";
import { getAgentPortalPath, isValidAgentPortalKey } from "../../../services/agentPortal";

export default defineEventHandler(async (event) => {
  if (!getAgentPortalPath()) {
    setResponseStatus(event, 503);
    return { success: false, code: "AGENT_PORTAL_NOT_CONFIGURED", message: "بوابة الوكلاء غير مهيأة" };
  }
  if (!isValidAgentPortalKey(getRequestHeader(event, "x-agent-portal-key"))) {
    setResponseStatus(event, 404);
    return { success: false, code: "AGENT_PORTAL_NOT_FOUND", message: "الصفحة غير موجودة" };
  }

  return { success: true };
});
