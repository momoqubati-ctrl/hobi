import { readBody, setResponseStatus } from "h3";
import { markAsRead } from "../../../services/notificationService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const body = await readBody(event);
  const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
  const userId = auth.userId;

  if (!notificationId) {
    setResponseStatus(event, 400);
    return { success: false, message: "notificationId مطلوب" };
  }

  try {
    await markAsRead(notificationId, userId);
    return { success: true };
  } catch (error) {
    console.error("markNotificationRead error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تحديث الحالة" };
  }
});
