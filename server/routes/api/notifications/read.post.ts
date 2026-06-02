import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { markAsRead } from "../../../services/notificationService";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { notificationId, userId } = body;

  if (!notificationId || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "notificationId, userId مطلوبان" };
  }

  try {
    await markAsRead(notificationId, userId);
    return { success: true };
  } catch (error) {
    console.error("markNotificationRead error:", error);
    return { success: false, message: "تعذر تحديث الحالة" };
  }
});
