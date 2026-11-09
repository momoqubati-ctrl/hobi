import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { getIO } from "../../../socket";
import {
  getTotalOnlineCount,
  pendingDisconnects,
  removeConnectedUser,
  removeUserPresenceByUserId,
} from "../../../socket/presenceManager";
import { endPrivateMessageSession, registerPrivateMessageSession } from "../../../services/privateMessageService";
import { getUserAuthContext } from "../../../services/adminAccess";
import { revokeSession } from "../../../services/tokenRevocation";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const auth = getUserAuthContext(event);
  console.log(`[SOCKET_TRACE_LOGOUT_API] sessionId=${auth.sessionId || ""} userId=${auth.userId || ""} ok=${auth.ok}`);
  if (!auth.ok || !auth.userId || !auth.sessionId) {
    setResponseStatus(event, auth.ok ? 401 : auth.statusCode);
    return { success: false, message: auth.ok ? "جلسة غير صالحة" : auth.message };
  }

  revokeSession(auth.sessionId, auth.expiresAt);

  registerPrivateMessageSession({
    sessionId: auth.sessionId,
    userId: auth.userId,
    expiresAt: auth.expiresAt,
  });
  endPrivateMessageSession(auth.sessionId, "logout");

  const io = getIO();
  if (io) {
    const sockets = await io.fetchSockets();
    const sessionSockets = sockets.filter(
      (socket) => String(socket.data?.user?.sessionId || "") === auth.sessionId,
    );
    for (const socket of sessionSockets) {
      socket.data.loggedOut = true;
      await removeConnectedUser(socket.id);
      socket.emit("force_logout", { message: "تم إنهاء الجلسة لتسجيل الخروج" });
      socket.disconnect(true);
    }

    const otherUserSessions = sockets.some(
      (socket) =>
        String(socket.data?.user?.id || "") === auth.userId &&
        String(socket.data?.user?.sessionId || "") !== auth.sessionId,
    );
    if (!otherUserSessions) {
      await removeUserPresenceByUserId(auth.userId);
      const pending = pendingDisconnects.get(auth.userId);
      if (pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        if (pending.presenceTimeout) clearTimeout(pending.presenceTimeout);
        pendingDisconnects.delete(auth.userId);
      }

      const count = await getTotalOnlineCount();
      io.emit("online_count", { count });
      io.emit("user_disconnected", { userId: auth.userId, count });
    }
  }

  return { success: true, message: "تم إنهاء الجلسة بنجاح" };
});
