import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getUnreadCount } from "../../../services/privateMessageService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const count = await getUnreadCount(userId);
    return { success: true, count };
  } catch (error) {
    console.error("getUnreadCount error:", error);
    return { success: false, message: "تعذر جلب عدد الرسائل غير المقروءة" };
  }
});
