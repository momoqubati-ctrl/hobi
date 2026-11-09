import { readBody, setResponseStatus } from "h3";
import { createFolder } from "../../../services/fileService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const body = await readBody(event);
  const userId = auth.userId;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const parentPath = typeof body?.parentPath === "string" ? body.parentPath : "/";

  if (!name) {
    setResponseStatus(event, 400);
    return { success: false, message: "اسم المجلد مطلوب" };
  }

  try {
    const folder = await createFolder(userId, name, parentPath);
    return { success: true, folder };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل إنشاء المجلد" };
  }
});
