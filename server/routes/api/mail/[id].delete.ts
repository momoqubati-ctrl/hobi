import { defineEventHandler, getRouterParam, getQuery, setResponseStatus } from "h3";
import { deleteMail } from "../../../services/internalMailService";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!id || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "id, userId مطلوبان" };
  }

  try {
    await deleteMail(id, userId);
    return { success: true };
  } catch (error) {
    console.error("deleteMail error:", error);
    return { success: false, message: "تعذر حذف البريد" };
  }
});
