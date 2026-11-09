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
