import { defineEventHandler, getRouterParam, getQuery, setResponseStatus } from "h3";
import { deleteFile } from "../../../services/fileService";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!id || !userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "id, userId مطلوبان" };
  }

  try {
    const result = await deleteFile(id, userId);
    return { success: true, ...result };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل حذف الملف" };
  }
});
