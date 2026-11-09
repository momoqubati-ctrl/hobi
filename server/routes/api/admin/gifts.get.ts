import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { dbPool } from "../../../db";
import { getAdminContext } from "../../../services/adminAccess";
import { handleApiError } from "../../../utils/apiError";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message, error: admin.message };
  }

  const query = getQuery(event);
  const categoryId = query.category_id as string | undefined;

  try {
    const { rows: colCheck } = await dbPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'gift_catalog' AND column_name = 'category_id'`
    );
    const hasCategoryId = colCheck.length > 0;

    let result;
    if (!hasCategoryId) {
      result = await dbPool.query(
        `SELECT g.*, '' as category_name FROM gift_catalog g ORDER BY g.created_at ASC`
      );
    } else if (categoryId) {
      result = await dbPool.query(
        `SELECT g.*, gc.name as category_name FROM gift_catalog g
         LEFT JOIN gift_categories gc ON gc.id = g.category_id
         WHERE g.category_id = $1
         ORDER BY g.created_at ASC`,
        [categoryId]
      );
    } else {
      result = await dbPool.query(
        `SELECT g.*, gc.name as category_name FROM gift_catalog g
         LEFT JOIN gift_categories gc ON gc.id = g.category_id
         ORDER BY g.created_at ASC`
      );
    }
    return { success: true, gifts: result.rows };
  } catch (error: any) {
    return handleApiError(event, error);
  }
});
