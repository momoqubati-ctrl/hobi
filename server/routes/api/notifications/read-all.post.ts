import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { markAllAsRead } from "../../../services/notificationService";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { userId } = body;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    await markAllAsRead(userId);
    return { success: true };
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    return { success: false, message: "تعذر تحديث الحالة" };
  }
});
