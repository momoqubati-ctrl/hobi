import { dbPool } from "../db";
import { publishSocketEvent } from "../socket/SocketBroker";

export type NotificationType = "like" | "comment" | "reply" | "gift" | "wall_post" | "follow" | "unfollow" | "mention" | "mail";

export const createNotification = async (
  userId: string,
  actorId: string,
  type: NotificationType,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, any> = {},
) => {
  // Don't notify yourself
  if (userId === actorId) return null;

  const result = await dbPool.query(
    `INSERT INTO notifications (user_id, actor_id, type, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, actor_id, type, entity_type, entity_id, metadata, read_at, created_at`,
    [userId, actorId, type, entityType, entityId, JSON.stringify(metadata)],
  );

  const row = result.rows[0];

  // جلب معلومات المستخدم (الاسم المستعار + صورة البروفايل + اللون)
  let actorName = "مستخدم";
  let actorAvatar = "/pic.png";
  let actorNameColor = "";
  try {
    console.log("[Notification] Looking up actor:", actorId, typeof actorId);
    const actorRes = await dbPool.query(
      `SELECT u.username, u.topic, u.pic, COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as actor_name_color
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE CAST(u.id AS TEXT) = $1 OR CAST(u.uid AS TEXT) = $1 OR CAST(u.idreg AS TEXT) = $1 LIMIT 1`,
      [String(actorId)]
    );
    console.log("[Notification] Actor query result:", actorRes.rows);
    if (actorRes.rows.length > 0) {
      const actor = actorRes.rows[0];
      actorName = actor.topic || actor.username || "مستخدم";
      actorAvatar = actor.pic || "/pic.png";
      actorNameColor = actor.actor_name_color || "";
    }
  } catch (e) {
    console.error("[Notification] Failed to fetch actor info:", e);
  }

  const notification = {
    id: String(row.id),
    userId: row.user_id,
    actorId: row.actor_id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    readAt: row.read_at,
    createdAt: row.created_at,
    actor: {
      name: actorName,
      avatar: actorAvatar,
      nameColor: actorNameColor,
    },
  };

  const channel = `notifications:${userId}`;

  // Emit real-time notification to the recipient only
  publishSocketEvent(channel, "notification", notification).catch(() => {});

  // Also emit unread count update to the recipient only
  publishSocketEvent(channel, "notification_unread", {
    userId,
    count: await getUnreadCount(userId),
  }).catch(() => {});

  return notification;
};

export const getNotifications = async (userId: string, limit = 30, offset = 0) => {
  const result = await dbPool.query(
    `SELECT n.id, n.user_id, n.actor_id, n.type, n.entity_type, n.entity_id, n.metadata, n.read_at, n.created_at,
            u.username as actor_name, u.topic as actor_display, u.pic as actor_avatar,
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as actor_name_color,
            up.gifted_banner_url as actor_gifted_banner_url,
            up.gifted_gift_icon_url as actor_gifted_gift_icon_url,
            up.gifted_promotion_icon_url as actor_gifted_promotion_icon_url,
            (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as actor_role_icon_url
     FROM notifications n
     LEFT JOIN users u ON CAST(u.id AS TEXT) = n.actor_id OR CAST(u.uid AS TEXT) = n.actor_id OR CAST(u.idreg AS TEXT) = n.actor_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  return result.rows.map((row: any) => ({
    id: String(row.id),
    userId: row.user_id,
    actorId: row.actor_id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {}),
    readAt: row.read_at,
    createdAt: row.created_at,
    actor: {
      name: row.actor_display || row.actor_name || "مستخدم",
      avatar: row.actor_avatar || "/pic.png",
      nameColor: row.actor_name_color || "",
      giftedBannerUrl: row.actor_gifted_banner_url || "",
      giftedGiftIconUrl: row.actor_gifted_gift_icon_url || "",
      giftedPromotionIconUrl: row.actor_gifted_promotion_icon_url || "",
      roleIconUrl: row.actor_role_icon_url || "",
    },
  }));
};

export const getUnreadCount = async (userId: string) => {
  const result = await dbPool.query(
    "SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    [userId],
  );
  return result.rows[0].count;
};

export const markAsRead = async (notificationId: string, userId: string) => {
  await dbPool.query(
    `UPDATE notifications SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId],
  );
};

export const markAllAsRead = async (userId: string) => {
  await dbPool.query(
    `UPDATE notifications SET read_at = now()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
};
