import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getMessages } from "../../../services/privateMessageService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const conversationId = query.conversationId as string;
  const userId = query.userId as string;
  const beforeId = query.beforeId as string | undefined;

  if (!conversationId || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "conversationId و userId مطلوبان" };
  }

  try {
    const messages = await getMessages(conversationId, userId, 50, beforeId);
    return { success: true, messages };
  } catch (error) {
    console.error("getMessages error:", error);
    return { success: false, message: "تعذر جلب الرسائل" };
  }
});
