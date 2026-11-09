import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  assertSafeTableName,
  getPrimaryKeyColumn,
  isAdminTableWritable,
  deleteTableRow,
  tableExists,
} from "../../../services/legacyAdminService";
import { getAdminContext } from "../../../services/adminAccess";

export default defineEventHandler(async (event) => {
  const admin = getAdminContext(event);
  if (!admin.ok) {
    setResponseStatus(event, admin.statusCode);
    return { success: false, message: admin.message };
  }

  const query = getQuery(event);
  const tableName = assertSafeTableName(query.table);
  const pkValue = query.id;

  if (!tableName || !pkValue) {
    setResponseStatus(event, 400);
    return { success: false, message: "اسم الجدول والمعرف مطلوبان" };
  }

  if (!isAdminTableWritable(tableName)) {
    setResponseStatus(event, 409);
    return { success: false, message: "لا يمكن تعديل هذا الجدول من محرر قاعدة البيانات" };
  }

  try {
    if (!(await tableExists(tableName))) {
      setResponseStatus(event, 404);
      return { success: false, message: "الجدول غير موجود" };
    }

    const pkColumn = await getPrimaryKeyColumn(tableName);
    await deleteTableRow(tableName, pkColumn, pkValue);
    
    return { success: true, message: "تم حذف السجل بنجاح" };
  } catch (err: unknown) {
    console.error("Admin database delete error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر حذف السجل" };
  }
});
