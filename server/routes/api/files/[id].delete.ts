import { getRouterParam, setResponseStatus } from "h3";
import { deleteFile } from "../../../services/fileService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const id = getRouterParam(event, "id");
  const userId = auth.userId;

  if (!id) {
    setResponseStatus(event, 400);
    return { success: false, message: "معرف الملف مطلوب" };
  }

  try {
    const result = await deleteFile(id, userId);
    return { success: true, ...result };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل حذف الملف" };
  }
});
