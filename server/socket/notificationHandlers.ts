import type { Server, Socket } from "socket.io";
import { getNotifications, markAsRead, markAllAsRead, getUnreadCount } from "../services/notificationService";

export function registerNotificationHandlers(io: Server, socket: Socket): void {
  const user = socket.data.user;

  /**
   * جلب الإشعارات للمستخدم
   */
  socket.on("notifications:get", async (data: { limit?: number; offset?: number }, callback?: (res: any) => void) => {
    try {
      const limit = typeof data?.limit === "number" ? data.limit : 30;
      const offset = typeof data?.offset === "number" ? data.offset : 0;
      
      const notifications = await getNotifications(user.id, limit, offset);
      const unreadCount = await getUnreadCount(user.id);
      
      callback?.({ 
        success: true, 
        notifications, 
        unreadCount 
      });
    } catch (err: any) {
      console.error("Error getting notifications via socket:", err);
      callback?.({ success: false, error: "تعذر جلب الإشعارات" });
    }
  });

  /**
   * تحديد إشعار محدد كمقروء
   */
  socket.on("notifications:mark_read", async (data: { notificationId: string }, callback?: (res: any) => void) => {
    const notificationId = String(data?.notificationId || "").trim();
    if (!notificationId) {
      callback?.({ success: false, error: "معرف التنبيه مطلوب" });
      return;
    }

    try {
      await markAsRead(notificationId, user.id);
      const unreadCount = await getUnreadCount(user.id);
      
      callback?.({ success: true, unreadCount });
    } catch (err: any) {
      console.error("Error marking notification read via socket:", err);
      callback?.({ success: false, error: "تعذر تحديث حالة التنبيه" });
    }
  });

  /**
   * تحديد جميع الإشعارات كمقروءة
   */
  socket.on("notifications:mark_all_read", async (callback?: (res: any) => void) => {
    try {
      await markAllAsRead(user.id);
      callback?.({ success: true });
    } catch (err: any) {
      console.error("Error marking all notifications read via socket:", err);
      callback?.({ success: false, error: "تعذر تحديث التنبيهات" });
    }
  });
}
