import { readBody, setResponseStatus } from "h3";
import { uploadFile } from "../../../services/fileService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const body = await readBody(event);
  const userId = auth.userId;
  const file = typeof body?.file === "string" ? body.file : "";
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const folder = typeof body?.folder === "string" ? body.folder : "/";

  if (!file || !filename) {
    setResponseStatus(event, 400);
    return { success: false, message: "الملف واسم الملف مطلوبان" };
  }

  try {
    const result = await uploadFile(userId, file, filename, folder);
    return { success: true, file: result };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل رفع الملف" };
  }
});
