import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { markConversationRead } from "../../../services/privateMessageService";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { conversationId, userId } = body;

  if (!conversationId || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "conversationId و userId مطلوبان" };
  }

  try {
    await markConversationRead(conversationId, userId);
    return { success: true };
  } catch (error) {
    console.error("markRead error:", error);
    return { success: false, message: "تعذر تحديث حالة القراءة" };
  }
});
