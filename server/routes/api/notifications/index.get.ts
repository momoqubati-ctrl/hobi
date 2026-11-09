import { getQuery, setResponseStatus } from "h3";
import { getNotifications } from "../../../services/notificationService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const query = getQuery(event);
  const userId = auth.userId;
  const limit = Math.min(Math.max(parseInt(query.limit as string, 10) || 30, 1), 100);
  const offset = Math.max(parseInt(query.offset as string, 10) || 0, 0);

  try {
    const notifications = await getNotifications(userId, limit, offset);
    return { success: true, notifications };
  } catch (error) {
    console.error("getNotifications error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب التنبيهات" };
  }
});
