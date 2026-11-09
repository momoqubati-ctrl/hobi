import { getQuery, getRouterParam, setResponseStatus } from "h3";
import { listMessages } from "../../../../services/chatStore";
import { createAuthenticatedUserHandler } from "../../../../services/authenticatedUserHandler";

export default createAuthenticatedUserHandler(async (event, _auth) => {
  const roomId = getRouterParam(event, "roomId");
  const query = getQuery(event);
  const after = typeof query.after === "string" ? query.after : undefined;

  if (!roomId || !roomId.trim()) {
    setResponseStatus(event, 400);
    return {
      success: false,
      message: "معرف الغرفة مطلوب",
    };
  }

  try {
    const messages = await listMessages(roomId.trim(), after);
    return {
      success: true,
      messages,
    };
  } catch (error) {
    console.error("listMessages error:", error);
    setResponseStatus(event, 500);
    return {
      success: false,
      message: "تعذر جلب الرسائل",
    };
  }
});
