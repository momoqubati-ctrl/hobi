import { addUserExp } from "./userLevelService";
import { dbPool } from "../db";

export interface GiftCatalogItem {
  id: string;
  name: string;
  icon: string;
  price: number;
  category: string;
}

export const listGifts = async (): Promise<GiftCatalogItem[]> => {
  const result = await dbPool.query(
    "SELECT id, name, icon, price, category FROM gift_catalog WHERE is_active = true ORDER BY price ASC",
  );
  return result.rows.map((row: any) => ({
    id: String(row.id),
    name: row.name,
    icon: row.icon,
    price: row.price,
    category: row.category,
  }));
};

export const sendGift = async (
  senderId: string,
  receiverId: string | null,
  giftId: string,
  quantity: number = 1,
) => {
  // 1. جلب الهدية من الكتالوج
  const giftRes = await dbPool.query("SELECT id, price FROM gift_catalog WHERE id = $1 AND is_active = true", [giftId]);
  if (giftRes.rows.length === 0) {
    throw new Error("الهدية غير موجودة");
  }
  const gift = giftRes.rows[0];
  const totalCoins = gift.price * quantity;

  // 2. جلب رصيد المرسل
  const senderRes = await dbPool.query(
    "SELECT user_id, coins FROM user_profiles WHERE user_id = $1",
    [senderId],
  );
  if (senderRes.rows.length === 0) {
    throw new Error("المرسل غير موجود");
  }
  const sender = senderRes.rows[0];
  const currentCoins = parseInt(sender.coins, 10) || 0;

  if (currentCoins < totalCoins) {
    throw new Error("رصيد غير كافٍ");
  }

  // 3. خصم العملات من المرسل (استخدام المعاملات لضمان الذرية)
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE user_profiles SET coins = coins - $1 WHERE user_id = $2 AND coins >= $1",
      [totalCoins, senderId],
    );

    if (receiverId) {
      await client.query(
        "UPDATE user_profiles SET gifts_received_count = COALESCE(gifts_received_count, 0) + $1 WHERE user_id = $2",
        [quantity, receiverId],
      );
    }

    const txnRes = await client.query(
      `INSERT INTO gift_transactions (gift_id, sender_id, receiver_id, quantity, total_coins)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [giftId, senderId, receiverId, quantity, totalCoins],
    );

    await client.query("COMMIT");

    // ترقية مستوى المرسل والمستقبل بناءً على قيمة الهدية
    addUserExp(senderId, totalCoins * 2, { source: "gift" }).catch(() => {});
    if (receiverId) {
      addUserExp(receiverId, totalCoins * 1, { source: "gift" }).catch(() => {});
    }

    const txn = txnRes.rows[0];
    return {
      id: String(txn.id),
      totalCoins,
      newBalance: currentCoins - totalCoins,
      createdAt: txn.created_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const getTopGifts = async (limit: number = 5) => {
  const result = await dbPool.query(
    `SELECT gc.name, gc.icon, COUNT(*)::int as count
     FROM gift_transactions gt
     JOIN gift_catalog gc ON gt.gift_id = gc.id
     WHERE gt.created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY gc.id, gc.name, gc.icon
     ORDER BY count DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
};

export const getUserCoins = async (userId: string) => {
  const result = await dbPool.query(
    "SELECT coins FROM user_profiles WHERE user_id = $1",
    [userId],
  );
  return result.rows.length > 0 ? parseInt(result.rows[0].coins, 10) || 0 : 0;
};
