import { getUnreadCount } from "../../../services/internalMailService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (_event, auth) => {
  try {
    const count = await getUnreadCount(auth.userId);
    return { success: true, count };
  } catch (error) {
    console.error("getUnreadMailCount error:", error);
    return { success: false, message: "تعذر جلب عدد الرسائل" };
  }
});
