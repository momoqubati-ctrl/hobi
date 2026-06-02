import { dbPool } from "../db";

export const sendMail = async (senderId: string, recipientId: string, body: string) => {
  if (!body.trim()) throw new Error("نص الرسالة فارغ");

  const subject = body.length > 100 ? body.slice(0, 100) + "..." : body;

  const result = await dbPool.query(
    `INSERT INTO internal_mail (sender_id, recipient_id, subject, body, from_uid, to_uid, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [senderId, recipientId, subject, body, senderId, recipientId, Date.now()],
  );

  const row = result.rows[0];
  return {
    id: String(row.id),
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at != null && row.read_at > 0 ? new Date(Number(row.read_at)).toISOString() : null,
    createdAt: row.created_at != null && row.created_at > 0 ? new Date(Number(row.created_at)).toISOString() : new Date().toISOString(),
  };
};

export const getInbox = async (userId: string) => {
  const mails = await dbPool.query(
    `SELECT im.*,
            u.username as sender_name, u.topic as sender_display, u.pic as sender_avatar
     FROM internal_mail im
     LEFT JOIN users u ON u.id = im.sender_id
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
    readAt: row.read_at != null && row.read_at > 0 ? new Date(Number(row.read_at)).toISOString() : null,
    createdAt: row.created_at != null && row.created_at > 0 ? new Date(Number(row.created_at)).toISOString() : new Date().toISOString(),
    senderName: row.sender_display || row.sender_name || row.sender_id,
    senderAvatar: row.sender_avatar || row.from_pic || "/pic.png",
  }));
};

export const getOutbox = async (userId: string) => {
  const mails = await dbPool.query(
    `SELECT im.*,
            u.username as recipient_name, u.topic as recipient_display, u.pic as recipient_avatar
     FROM internal_mail im
     LEFT JOIN users u ON u.id = im.recipient_id
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
    readAt: row.read_at != null && row.read_at > 0 ? new Date(Number(row.read_at)).toISOString() : null,
    createdAt: row.created_at != null && row.created_at > 0 ? new Date(Number(row.created_at)).toISOString() : new Date().toISOString(),
    recipientName: row.recipient_display || row.recipient_name || row.recipient_id,
    recipientAvatar: row.recipient_avatar || row.to_pic || "/pic.png",
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
