import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { listFiles } from "../../../services/fileService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;
  const folderPath = (query.folder as string) || "/";

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const files = await listFiles(userId, folderPath);
    return { success: true, files };
  } catch (error) {
    console.error("listFiles error:", error);
    return { success: false, message: "تعذر جلب الملفات" };
  }
});
