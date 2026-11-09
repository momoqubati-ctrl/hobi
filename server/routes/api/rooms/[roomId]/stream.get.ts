import { createEventStream, defineEventHandler, getRouterParam, setHeader, setResponseStatus } from "h3";
import { listMessages, subscribeToRoom } from "../../../../services/chatStore";
import { getUserAuthContext } from "../../../../services/adminAccess";

const MAX_SSE_PER_USER = 5;
const activeSseConnections = new Map<string, number>();

export default defineEventHandler(async (event) => {
  const auth = getUserAuthContext(event);
  if (!auth.ok || !auth.userId) {
    setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
    return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
  }

  const roomId = getRouterParam(event, "roomId");
  if (!roomId || !roomId.trim()) {
    setResponseStatus(event, 400);
    return {
      success: false,
      message: "معرف الغرفة مطلوب",
    };
  }

  const currentCount = activeSseConnections.get(auth.userId) || 0;
  if (currentCount >= MAX_SSE_PER_USER) {
    setResponseStatus(event, 429);
    return {
      success: false,
      message: "تم تجاوز الحد الأقصى لاتصالات البث المتزامنة",
    };
  }
  activeSseConnections.set(auth.userId, currentCount + 1);

  setHeader(event, "Cache-Control", "no-cache, no-transform");
  setHeader(event, "X-Accel-Buffering", "no");

  const eventStream = createEventStream(event);

  try {
    const messages = await listMessages(roomId.trim());
    messages.forEach((message) => {
      eventStream.push(JSON.stringify({ type: "message", message }));
    });
  } catch (error) {
    console.error("SSE initial messages error:", error);
  }

  const unsubscribe = subscribeToRoom(roomId.trim(), (message) => {
    eventStream.push(JSON.stringify({ type: "message", message }));
  });

  const heartbeat = setInterval(() => {
    eventStream.push(JSON.stringify({ type: "ping", at: new Date().toISOString() }));
  }, 25000);

  eventStream.onClosed(() => {
    clearInterval(heartbeat);
    unsubscribe();
    const count = activeSseConnections.get(auth.userId) || 1;
    if (count <= 1) {
      activeSseConnections.delete(auth.userId);
    } else {
      activeSseConnections.set(auth.userId, count - 1);
    }
  });

  return eventStream.send();
});
