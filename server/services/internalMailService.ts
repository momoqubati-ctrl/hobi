import { dbPool } from "../db";

export const sendMail = async (senderId: string, recipientId: string, body: string) => {
  if (!body.trim()) throw new Error("نص الرسالة فارغ");

  const subject = body.length > 100 ? body.slice(0, 100) + "..." : body;

  const result = await dbPool.query(
    `INSERT INTO internal_mail (sender_id, recipient_id, subject, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [senderId, recipientId, subject, body],
  );

  const row = result.rows[0];

  const senderRes = await dbPool.query(
    `SELECT COALESCE(NULLIF(topic,''), NULLIF(username,'')) as name, pic as avatar
     FROM users WHERE id = $1 OR uid = $1 OR idreg::text = $1 LIMIT 1`,
    [senderId],
  );
  const recipientRes = await dbPool.query(
    `SELECT COALESCE(NULLIF(topic,''), NULLIF(username,'')) as name, pic as avatar
     FROM users WHERE id = $1 OR uid = $1 OR idreg::text = $1 LIMIT 1`,
    [recipientId],
  );

  const senderUser = senderRes.rows[0];
  const recipientUser = recipientRes.rows[0];

  return {
    id: String(row.id),
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    senderName: senderUser?.name || senderId,
    senderAvatar: senderUser?.avatar || "/pic.png",
    recipientName: recipientUser?.name || recipientId,
    recipientAvatar: recipientUser?.avatar || "/pic.png",
  };
};

export const getInbox = async (userId: string) => {
  const mails = await dbPool.query(
    `SELECT im.*,
            COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as sender_name,
            u.pic as sender_avatar
     FROM internal_mail im
     LEFT JOIN users u ON u.id = im.sender_id OR u.uid = im.sender_id OR u.idreg::text = im.sender_id
     WHERE im.recipient_id = $1
     ORDER BY im.created_at DESC`,
    [userId],
  );

  return mails.rows.map((row: any) => ({
    id: String(row.id),
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    senderName: row.sender_name || row.sender_id,
    senderAvatar: row.sender_avatar || "/pic.png",
  }));
};

export const getOutbox = async (userId: string) => {
  const mails = await dbPool.query(
    `SELECT im.*,
            COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as recipient_name,
            u.pic as recipient_avatar
     FROM internal_mail im
     LEFT JOIN users u ON u.id = im.recipient_id OR u.uid = im.recipient_id OR u.idreg::text = im.recipient_id
     WHERE im.sender_id = $1
     ORDER BY im.created_at DESC`,
    [userId],
  );

  return mails.rows.map((row: any) => ({
    id: String(row.id),
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    recipientName: row.recipient_name || row.recipient_id,
    recipientAvatar: row.recipient_avatar || "/pic.png",
  }));
};

export const markAsRead = async (mailId: string, userId: string) => {
  await dbPool.query(
    `UPDATE internal_mail SET read_at = now()
     WHERE id = $1 AND recipient_id = $2 AND read_at IS NULL`,
    [mailId, userId],
  );
};

export const deleteMail = async (mailId: string, userId: string) => {
  await dbPool.query(
    `DELETE FROM internal_mail
     WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)`,
    [mailId, userId],
  );
};

export const getUnreadCount = async (userId: string) => {
  const result = await dbPool.query(
    "SELECT COUNT(*)::int as count FROM internal_mail WHERE recipient_id = $1 AND read_at IS NULL",
    [userId],
  );
  return result.rows[0].count;
};
