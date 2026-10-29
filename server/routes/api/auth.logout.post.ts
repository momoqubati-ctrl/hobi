import { defineEventHandler, getHeader, readBody } from "h3";
import { getIO } from "../../socket";
import {
  removeConnectedUser,
  removeUserPresenceByUserId,
  getTotalOnlineCount,
  pendingDisconnects,
} from "../../socket/presenceManager";

export default defineEventHandler(async (event) => {
  try {
    const authHeader = getHeader(event, "authorization") || "";
    const body = await readBody(event).catch(() => ({}));

    let userId = body?.userId ? String(body.userId).trim() : "";
    if (!userId && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.slice(7);
        const [payloadB64] = token.split(".");
        if (payloadB64) {
          const json = Buffer.from(payloadB64, "base64url").toString("utf8");
          const parsed = JSON.parse(json);
          userId = String(parsed.sub || parsed.id || "").trim();
        }
      } catch {}
    }

    if (userId) {
      await removeUserPresenceByUserId(userId);

      const pending = pendingDisconnects.get(userId);
      if (pending) {
        if (pending.timeout) clearTimeout(pending.timeout);
        if (pending.presenceTimeout) clearTimeout(pending.presenceTimeout);
        pendingDisconnects.delete(userId);
      }

      const io = getIO();
      if (io) {
        try {
          const sockets = await io.fetchSockets();
          for (const s of sockets) {
            if (s.data?.user?.id && String(s.data.user.id) === userId) {
              s.data.loggedOut = true;
              await removeConnectedUser(s.id);
              s.emit("force_logout", { message: "تم إنهاء الجلسة لتسجيل الخروج" });
              s.disconnect(true);
            }
          }
          if (io.sockets?.sockets) {
            for (const [sid, s] of io.sockets.sockets.entries()) {
              if (s.data?.user?.id && String(s.data.user.id) === userId) {
                s.data.loggedOut = true;
                await removeConnectedUser(sid);
                s.emit("force_logout", { message: "تم إنهاء الجلسة لتسجيل الخروج" });
                s.disconnect(true);
              }
            }
          }
        } catch (sockErr) {
          console.warn("[auth.logout.post] failed to disconnect sockets:", sockErr);
        }

        try {
          const count = await getTotalOnlineCount();
          io.emit("online_count", { count });
          io.emit("user_disconnected", {
            userId,
            count,
          });
        } catch {}
      }

      // في بيئة تطوير Vite، إرسال إشعار للميدلوير الداخلي لقطع السوكيت المحلي
      try {
        const { Agent } = await import("undici");
        const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
        await fetch("https://127.0.0.1:3000/__terminate_user_sessions__", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
          dispatcher,
        } as any).catch(() => {});
      } catch {}
    }

    return {
      success: true,
      message: "تم إنهاء جميع الجلسات بنجاح",
    };
  } catch (error) {
    console.error("[auth.logout.post] Error handling logout:", error);
    return {
      success: true,
      message: "تم تسجيل الخروج",
    };
  }
});
