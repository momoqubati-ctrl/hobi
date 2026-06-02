import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getStorageQuota } from "../../../services/fileService";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const userId = query.userId as string;

  if (!userId) {
    setResponseStatus(event, 400);
    return { success: false, message: "userId مطلوب" };
  }

  try {
    const quota = await getStorageQuota(userId);
    return { success: true, ...quota };
  } catch (error) {
    console.error("getStorageQuota error:", error);
    return { success: false, message: "تعذر جلب المساحة" };
  }
});
