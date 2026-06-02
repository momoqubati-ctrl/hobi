import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getConversations } from "../../../services/privateMessageService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const conversations = await getConversations(userId);
    console.log(`[PM conversations] userId=${userId} → ${conversations.length} conversations:`, JSON.stringify(conversations, null, 2));
    return { success: true, conversations };
  } catch (error) {
    console.error("getConversations error:", error);
    return { success: false, message: "تعذر جلب المحادثات" };
  }
});
