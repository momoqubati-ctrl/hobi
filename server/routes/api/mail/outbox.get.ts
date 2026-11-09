import { getOutbox } from "../../../services/internalMailService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (_event, auth) => {
  try {
    const mails = await getOutbox(auth.userId);
    return { success: true, mails };
  } catch (error) {
    console.error("getOutbox error:", error);
    return { success: false, message: "تعذر جلب البريد المرسل" };
  }
});
