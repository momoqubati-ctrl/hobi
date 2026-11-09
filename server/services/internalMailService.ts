import { dbPool } from "../db";

type IdentityQueryResult = {
  rows: Array<{ user_id?: string; identity_key?: string }>;
};
type IdentityQuery = (sql: string, params: string[]) => Promise<IdentityQueryResult>;

const queryIdentity: IdentityQuery = (sql, params) => dbPool.query(sql, params);

export async function resolveInternalMailUserId(
  inputId: string,
  query: IdentityQuery = queryIdentity,
): Promise<string> {
  const result = await query(
    `SELECT DISTINCT u.id::text AS user_id
     FROM users u
     WHERE u.id::text = $1 OR u.uid::text = $1 OR u.idreg::text = $1`,
    [inputId],
  );
  const userIds = [...new Set(result.rows.map((row) => row.user_id).filter(
    (userId): userId is string => typeof userId === "string" && userId.length > 0,
  ))];
  if (userIds.length !== 1) {
    throw new Error(userIds.length === 0
      ? "Unknown internal mail participant"
      : "Ambiguous internal mail participant");
  }
  return userIds[0];
}

async function getMailIdentityKeys(
  userId: string,
  query: IdentityQuery = queryIdentity,
): Promise<string[]> {
  const account = await query(
    "SELECT id::text AS user_id FROM users WHERE id::text = $1",
    [userId],
  );
  if (account.rows.length !== 1 || account.rows[0].user_id !== userId) {
    throw new Error("Unknown internal mail account");
  }

  const legacyKeys = await query(
    `SELECT candidate.identity_key
     FROM (
       SELECT uid::text AS identity_key FROM users
       WHERE id::text = $1 AND uid IS NOT NULL AND uid::text <> ''
       UNION
       SELECT idreg::text AS identity_key FROM users
       WHERE id::text = $1 AND idreg IS NOT NULL AND idreg::text <> ''
     ) candidate
     WHERE (
       SELECT COUNT(DISTINCT matched.id)
       FROM users matched
       WHERE matched.id::text = candidate.identity_key
          OR matched.uid::text = candidate.identity_key
          OR matched.idreg::text = candidate.identity_key
     ) = 1`,
    [userId],
  );
  return [...new Set([
    userId,
    ...legacyKeys.rows
      .map((row) => row.identity_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  ])];
}

export const sendMail = async (senderId: string, recipientId: string, body: string) => {
  if (!body.trim()) throw new Error("نص الرسالة فارغ");

  const [canonicalSenderId, canonicalRecipientId] = await Promise.all([
    resolveInternalMailUserId(senderId),
    resolveInternalMailUserId(recipientId),
  ]);
  const subject = body.length > 100 ? body.slice(0, 100) + "..." : body;

  const senderRes = await dbPool.query(
    `SELECT COALESCE(NULLIF(u.topic,''), NULLIF(u.username,'')) as name, u.pic as avatar,
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as name_color,
            COALESCE(NULLIF(up.status_font_color, ''), NULLIF(u.scol, '')) as status_font_color,
            up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url,
            (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as role_icon_url
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id::text = $1`,
    [canonicalSenderId],
  );
  const recipientRes = await dbPool.query(
    `SELECT COALESCE(NULLIF(u.topic,''), NULLIF(u.username,'')) as name, u.pic as avatar,
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as name_color,
            COALESCE(NULLIF(up.status_font_color, ''), NULLIF(u.scol, '')) as status_font_color,
            up.gifted_banner_url, up.gifted_gift_icon_url, up.gifted_promotion_icon_url,
            (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as role_icon_url
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id::text = $1`,
    [canonicalRecipientId],
  );

  const senderUser = senderRes.rows[0];
  const recipientUser = recipientRes.rows[0];
  if (!senderUser || !recipientUser) {
    throw new Error("Internal mail participant no longer exists");
  }

  const result = await dbPool.query(
    `INSERT INTO internal_mail (sender_id, recipient_id, subject, body)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [canonicalSenderId, canonicalRecipientId, subject, body],
  );
  const row = result.rows[0];

  return {
    id: String(row.id),
    senderId: canonicalSenderId,
    recipientId: canonicalRecipientId,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    senderName: senderUser?.name || senderId,
    senderAvatar: senderUser?.avatar || "/pic.png",
    senderNameColor: senderUser?.name_color || "",
    senderStatusFontColor: senderUser?.status_font_color || "",
    senderGiftedBannerUrl: senderUser?.gifted_banner_url || "",
    senderGiftedGiftIconUrl: senderUser?.gifted_gift_icon_url || "",
    senderGiftedPromotionIconUrl: senderUser?.gifted_promotion_icon_url || "",
    senderRoleIconUrl: senderUser?.role_icon_url || "",
    recipientName: recipientUser?.name || recipientId,
    recipientAvatar: recipientUser?.avatar || "/pic.png",
    recipientNameColor: recipientUser?.name_color || "",
    recipientStatusFontColor: recipientUser?.status_font_color || "",
    recipientGiftedBannerUrl: recipientUser?.gifted_banner_url || "",
    recipientGiftedGiftIconUrl: recipientUser?.gifted_gift_icon_url || "",
    recipientGiftedPromotionIconUrl: recipientUser?.gifted_promotion_icon_url || "",
    recipientRoleIconUrl: recipientUser?.role_icon_url || "",
  };
};

export const getInbox = async (userId: string) => {
  const identityKeys = await getMailIdentityKeys(userId);
  const mails = await dbPool.query(
    `SELECT im.*,
            COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as sender_name,
            u.pic as sender_avatar,
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as sender_name_color,
            COALESCE(NULLIF(up.status_font_color, ''), NULLIF(u.scol, '')) as sender_status_font_color,
            up.gifted_banner_url as sender_gifted_banner_url,
            up.gifted_gift_icon_url as sender_gifted_gift_icon_url,
            up.gifted_promotion_icon_url as sender_gifted_promotion_icon_url,
            (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as sender_role_icon_url
     FROM internal_mail im
     LEFT JOIN users u ON u.id::text = im.sender_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE im.recipient_id = ANY($1::text[])
     ORDER BY im.created_at DESC`,
    [identityKeys],
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
    senderNameColor: row.sender_name_color || "",
    senderStatusFontColor: row.sender_status_font_color || "",
    senderGiftedBannerUrl: row.sender_gifted_banner_url || "",
    senderGiftedGiftIconUrl: row.sender_gifted_gift_icon_url || "",
    senderGiftedPromotionIconUrl: row.sender_gifted_promotion_icon_url || "",
    senderRoleIconUrl: row.sender_role_icon_url || "",
  }));
};

export const getOutbox = async (userId: string) => {
  const identityKeys = await getMailIdentityKeys(userId);
  const mails = await dbPool.query(
    `SELECT im.*,
            COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as recipient_name,
            u.pic as recipient_avatar,
            COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as recipient_name_color,
            up.gifted_banner_url as recipient_gifted_banner_url,
            up.gifted_gift_icon_url as recipient_gifted_gift_icon_url,
            up.gifted_promotion_icon_url as recipient_gifted_promotion_icon_url,
            (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as recipient_role_icon_url
     FROM internal_mail im
     LEFT JOIN users u ON u.id::text = im.recipient_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE im.sender_id = ANY($1::text[])
     ORDER BY im.created_at DESC`,
    [identityKeys],
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
    recipientNameColor: row.recipient_name_color || "",
    recipientGiftedBannerUrl: row.recipient_gifted_banner_url || "",
    recipientGiftedGiftIconUrl: row.recipient_gifted_gift_icon_url || "",
    recipientGiftedPromotionIconUrl: row.recipient_gifted_promotion_icon_url || "",
    recipientRoleIconUrl: row.recipient_role_icon_url || "",
  }));
};

export const markAsRead = async (mailId: string, userId: string) => {
  const identityKeys = await getMailIdentityKeys(userId);
  await dbPool.query(
    `UPDATE internal_mail SET read_at = now()
     WHERE id = $1 AND recipient_id = ANY($2::text[]) AND read_at IS NULL`,
    [mailId, identityKeys],
  );
};

export const deleteMail = async (mailId: string, userId: string) => {
  const identityKeys = await getMailIdentityKeys(userId);
  await dbPool.query(
    `DELETE FROM internal_mail
     WHERE id = $1 AND (sender_id = ANY($2::text[]) OR recipient_id = ANY($2::text[]))`,
    [mailId, identityKeys],
  );
};

export const getUnreadCount = async (userId: string) => {
  const identityKeys = await getMailIdentityKeys(userId);
  const result = await dbPool.query(
    "SELECT COUNT(*)::int as count FROM internal_mail WHERE recipient_id = ANY($1::text[]) AND read_at IS NULL",
    [identityKeys],
  );
  return result.rows[0].count;
};
