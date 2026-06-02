import { defineEventHandler, readBody, getRouterParam, setResponseStatus } from "h3";
import { renameFile } from "../../../services/fileService";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const body = await readBody(event);
  const { userId, name } = body;

  if (!id || !userId || !name?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "id, userId, name مطلوبون" };
  }

  try {
    const result = await renameFile(id, userId, name);
    return { success: true, file: result };
  } catch (error: any) {
    setResponseStatus(event, 400);
    return { success: false, message: error.message || "فشل إعادة التسمية" };
  }
});
