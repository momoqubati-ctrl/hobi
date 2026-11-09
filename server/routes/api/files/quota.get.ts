import { setResponseStatus } from "h3";
import { getStorageQuota } from "../../../services/fileService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const userId = auth.userId;

  try {
    const quota = await getStorageQuota(userId);
    return { success: true, ...quota };
  } catch (error) {
    console.error("getStorageQuota error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب المساحة" };
  }
});
