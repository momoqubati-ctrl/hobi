import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getOutbox } from "../../../services/internalMailService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const mails = await getOutbox(userId);
    return { success: true, mails };
  } catch (error) {
    console.error("getOutbox error:", error);
    return { success: false, message: "تعذر جلب البريد المرسل" };
  }
});
