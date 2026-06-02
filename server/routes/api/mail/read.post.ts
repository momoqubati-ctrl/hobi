import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { markAsRead } from "../../../services/internalMailService";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { mailId, userId } = body;

  if (!mailId || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "mailId, userId مطلوبان" };
  }

  try {
    await markAsRead(mailId, userId);
    return { success: true };
  } catch (error) {
    console.error("markAsRead error:", error);
    return { success: false, message: "تعذر تحديث الحالة" };
  }
});
