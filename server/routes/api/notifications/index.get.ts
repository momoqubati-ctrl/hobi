import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getNotifications } from "../../../services/notificationService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;
  const limit = parseInt(query.limit as string, 10) || 30;
  const offset = parseInt(query.offset as string, 10) || 0;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const notifications = await getNotifications(userId, limit, offset);
    return { success: true, notifications };
  } catch (error) {
    console.error("getNotifications error:", error);
    return { success: false, message: "تعذر جلب التنبيهات" };
  }
});
