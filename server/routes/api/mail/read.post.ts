import { readBody, setResponseStatus } from "h3";
import { markAsRead } from "../../../services/internalMailService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const body = await readBody<Record<string, unknown> | null>(event);
  const mailId = typeof body?.mailId === "string" || typeof body?.mailId === "number"
    ? String(body.mailId).trim()
    : "";

  if (!mailId) {
    setResponseStatus(event, 400);
    return { success: false, message: "mailId مطلوب" };
  }

  try {
    await markAsRead(mailId, auth.userId);
    return { success: true };
  } catch (error) {
    console.error("markAsRead error:", error);
    return { success: false, message: "تعذر تحديث الحالة" };
  }
});
