import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { uploadFile } from "../../../services/fileService";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { userId, file, filename, folder } = body;

  if (!userId || !file || !filename) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId, file, filename مطلوبون" };
  }

  try {
    const result = await uploadFile(userId, file, filename, folder || "/");
    return { success: true, file: result };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل رفع الملف" };
  }
});
