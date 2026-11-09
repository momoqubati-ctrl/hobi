import { getInbox } from "../../../services/internalMailService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (_event, auth) => {
  try {
    const mails = await getInbox(auth.userId);
    return { success: true, mails };
  } catch (error) {
    console.error("getInbox error:", error);
    return { success: false, message: "تعذر جلب البريد الوارد" };
  }
});
