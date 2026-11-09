import { readBody, getRouterParam, setResponseStatus } from "h3";
import { renameFile } from "../../../services/fileService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const id = getRouterParam(event, "id");
  const body = await readBody(event);
  const userId = auth.userId;
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!id || !name) {
    setResponseStatus(event, 400);
    return { success: false, message: "معرف الملف والاسم الجديد مطلوبان" };
  }

  try {
    const result = await renameFile(id, userId, name);
    return { success: true, file: result };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل إعادة التسمية" };
  }
});
