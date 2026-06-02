import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { createFolder } from "../../../services/fileService";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { userId, name, parentPath } = body;

  if (!userId || !name?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId, name مطلوبان" };
  }

  try {
    const folder = await createFolder(userId, name, parentPath || "/");
    return { success: true, folder };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل إنشاء المجلد" };
  }
});
