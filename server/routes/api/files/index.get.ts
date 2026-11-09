import { getQuery, setResponseStatus } from "h3";
import { listFiles } from "../../../services/fileService";
import { createAuthenticatedUserHandler } from "../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, auth) => {
  const query = getQuery(event);
  const userId = auth.userId;
  const folderPath = typeof query.folder === "string" ? query.folder : "/";

  try {
    const files = await listFiles(userId, folderPath);
    return { success: true, files };
  } catch (error) {
    console.error("listFiles error:", error);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر جلب الملفات" };
  }
});
