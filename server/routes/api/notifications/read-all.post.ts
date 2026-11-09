import { setResponseStatus } from "h3";
import { markAllAsRead } from "../../../services/notificationService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const userId = auth.userId;

  try {
    await markAllAsRead(userId);
    return { success: true };
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تحديث الحالة" };
  }
});
