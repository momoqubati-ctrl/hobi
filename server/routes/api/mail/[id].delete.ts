import { getRouterParam, setResponseStatus } from "h3";
import { deleteMail } from "../../../services/internalMailService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    setResponseStatus(event, 400);
    return { success: false, message: "id مطلوب" };
  }

  try {
    await deleteMail(id, auth.userId);
    return { success: true };
  } catch (error) {
    console.error("deleteMail error:", error);
    return { success: false, message: "تعذر حذف البريد" };
  }
});
