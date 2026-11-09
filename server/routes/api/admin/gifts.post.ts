import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message, error: admin.message };
  }

  const body = await readBody<{ name: string; icon: string; price: number; category_id?: string; category?: string }>(event);
  if (!body?.name?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "اسم الهدية مطلوب" };
  }
  if (!body?.icon?.trim()) {
    setResponseStatus(event, 400);
    return { success: false, message: "الايقونة مطلوبة" };
  }
  if (body.price == null || body.price < 0) {
    setResponseStatus(event, 400);
    return { success: false, message: "السعر مطلوب" };
  }

  try {
    const { rows: iconCol } = await dbPool.query(
      `SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'gift_catalog' AND column_name = 'icon'`
    );
    if (iconCol.length > 0 && iconCol[0].character_maximum_length) {
      await dbPool.query(`ALTER TABLE "gift_catalog" ALTER COLUMN "icon" TYPE text`).catch(() => {});
    }
    await dbPool.query(`ALTER TABLE "gift_catalog" ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "gift_categories"("id") ON DELETE SET NULL;`).catch(() => {});

    const result = await dbPool.query(
      `INSERT INTO gift_catalog (name, icon, price, category_id, category) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name.trim(), body.icon.trim(), body.price, body.category_id || null, body.category || "common"]
    );
    return { success: true, gift: result.rows[0] };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
