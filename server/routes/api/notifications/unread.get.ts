import { setResponseStatus } from "h3";
import { getUnreadCount } from "../../../services/notificationService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const userId = auth.userId;

  try {
    const count = await getUnreadCount(userId);
    return { success: true, count };
  } catch (error) {
    console.error("getUnreadNotificationCount error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب عدد التنبيهات" };
  }
});
