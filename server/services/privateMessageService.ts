import { dbPool } from "../db";

const buildConversationId = (a: string, b: string) =>
  [a, b].sort().join(":");

/**
 * يوحّد معرّف المستخدم إلى uid النصي لأنه:
 * 1) يطابق localStorage.user.id المُستخدم في الواجهة
 * 2) يطابق ما يتم تخزينه في private_messages.sender_id / receiver_id
 * 3) ثابت ولا يتغير بين تسجيلات الدخول
 *
 * يقبل أي شكل من المعرّف (uid, id uuid, idreg) ويُرجع uid دائماً.
 */
const resolveUserKey = async (rawId: string): Promise<string> => {
  const id = String(rawId || "").trim();
  if (!id) return id;
  const res = await dbPool.query(
    `SELECT uid, id::text AS id FROM users
     WHERE uid = $1 OR id::text = $1 OR idreg::text = $1 OR lower(username) = lower($1)
     LIMIT 1`,
    [id],
  );
  if (res.rows[0]) {
    return String(res.rows[0].uid || res.rows[0].id || id);
  }
  return id;
};

export const sendPrivateMessage = async (
  senderId: string,
  receiverId: string,
  body: string,
) => {
  if (!body.trim()) throw new Error("الرسالة فارغة");

  // توحيد المعرّفين إلى uid لضمان تطابقها مع localStorage
  const normalizedSender = await resolveUserKey(senderId);
  const normalizedReceiver = await resolveUserKey(receiverId);

  const conversationId = buildConversationId(normalizedSender, normalizedReceiver);

  const result = await dbPool.query(
    `INSERT INTO private_messages (conversation_id, sender_id, receiver_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, conversation_id, sender_id, receiver_id, body, read_at, created_at`,
    [conversationId, normalizedSender, normalizedReceiver, body],
  );

  const row = result.rows[0];
  return {
    id: String(row.id),
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
};

export const getConversations = async (userId: string) => {
  // توحيد المعرّف إلى uid ليوافق المعرّفات المخزّنة في private_messages
  const normalizedId = await resolveUserKey(userId);

  const result = await dbPool.query(
    `SELECT DISTINCT ON (pm.conversation_id)
            pm.conversation_id, pm.id, pm.body, pm.sender_id, pm.receiver_id,
            pm.created_at, pm.read_at,
            CASE WHEN pm.sender_id = $1 THEN pm.receiver_id ELSE pm.sender_id END as other_user_id
     FROM private_messages pm
     WHERE pm.sender_id = $1 OR pm.receiver_id = $1
     ORDER BY pm.conversation_id, pm.created_at DESC`,
    [normalizedId],
  );

  // جلب أسماء وصور المستخدمين الآخرين
  const otherIds = [...new Set(result.rows.map((r: any) => r.other_user_id).filter((id: any) => id != null && id !== ""))];
  if (otherIds.length === 0) return [];

  // بناء المعاملات بدون $1 مُهمل - PostgreSQL لا يستطيع تحديد نوع معامل غير مُستخدم في الاستعلام
  const params: any[] = [];
  let idx = 1;
  const idPlaceholders = otherIds.map(() => `$${idx++}`).join(",");
  const uidPlaceholders = otherIds.map(() => `$${idx++}`).join(",");
  const namePlaceholders = otherIds.map(() => `$${idx++}`).join(",");

  params.push(...otherIds, ...otherIds, ...otherIds.map((id: string) => String(id).toLowerCase()));

  const usersRes = await dbPool.query(
    `SELECT id, uid, username, topic as display_name, pic FROM users WHERE id::text IN (${idPlaceholders}) OR uid::text IN (${uidPlaceholders}) OR lower(username) IN (${namePlaceholders})`,
    params,
  );
  const userMap = new Map<string, any>();
  for (const u of usersRes.rows) {
    userMap.set(String(u.id), u);
    if (u.uid) userMap.set(String(u.uid), u);
    if (u.username) userMap.set(u.username.toLowerCase(), u);
  }

  // جلب عدد الرسائل غير المقروءة
  const unreadRes = await dbPool.query(
    `SELECT conversation_id, COUNT(*)::int as unread
     FROM private_messages
     WHERE receiver_id = $1 AND read_at IS NULL
     GROUP BY conversation_id`,
    [normalizedId],
  );
  const unreadMap = new Map<string, number>();
  for (const r of unreadRes.rows) {
    unreadMap.set(r.conversation_id, r.unread);
  }

  return result.rows.map((row: any) => {
    const otherUser = userMap.get(row.other_user_id) || userMap.get(String(row.other_user_id)) || userMap.get(String(row.other_user_id).toLowerCase()) || {};
    return {
      conversationId: row.conversation_id,
      lastMessage: row.body,
      lastMessageAt: row.created_at,
      otherUser: {
        id: row.other_user_id,
        name: otherUser.display_name || otherUser.username || "عضو",
        avatar: otherUser.pic || "/pic.png",
      },
      unreadCount: unreadMap.get(row.conversation_id) || 0,
    };
  });
};

export const getMessages = async (conversationId: string, userId: string, limit = 50, beforeId?: string) => {
  const normalizedId = await resolveUserKey(userId);

  let query = `
    SELECT id, conversation_id, sender_id, receiver_id, body, read_at, created_at
    FROM private_messages
    WHERE conversation_id = $1
  `;
  const params: any[] = [conversationId];

  if (beforeId) {
    query += ` AND created_at < (SELECT created_at FROM private_messages WHERE id = $2)`;
    params.push(beforeId);
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await dbPool.query(query, params);

  // تعليم الرسائل كمقروءة
  await dbPool.query(
    `UPDATE private_messages SET read_at = now()
     WHERE conversation_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
    [conversationId, normalizedId],
  );

  return result.rows.reverse().map((row: any) => ({
    id: String(row.id),
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
    isMine: row.sender_id === normalizedId,
  }));
};

export const markConversationRead = async (conversationId: string, userId: string) => {
  const normalizedId = await resolveUserKey(userId);
  await dbPool.query(
    `UPDATE private_messages SET read_at = now()
     WHERE conversation_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
    [conversationId, normalizedId],
  );
};

export const getUnreadCount = async (userId: string) => {
  const normalizedId = await resolveUserKey(userId);
  const result = await dbPool.query(
    "SELECT COUNT(*)::int as count FROM private_messages WHERE receiver_id = $1 AND read_at IS NULL",
    [normalizedId],
  );
  return result.rows[0].count;
};
