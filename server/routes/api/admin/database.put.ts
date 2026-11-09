import { defineEventHandler, readBody, getQuery, setResponseStatus } from "h3";
import {
  assertSafeTableName,
  getPrimaryKeyColumn,
  isAdminDatabaseAccessError,
  isAdminTableWritable,
  isWalletWriteFenceError,
  updateTableRow,
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

  if (!tableName) {
    setResponseStatus(event, 400);
    return { success: false, message: "اسم الجدول مطلوب" };
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

    const body = await readBody(event);
    if (!body || typeof body !== "object" || !body.pkValue) {
      setResponseStatus(event, 400);
      return { success: false, message: "المفتاح الأساسي والبيانات مطلوبة" };
    }

    const pkColumn = await getPrimaryKeyColumn(tableName);
    const updatedRow = await updateTableRow(tableName, pkColumn, body.pkValue, body.data);
    
    return { success: true, row: updatedRow };
  } catch (err: unknown) {
    console.error("Admin database update error:", err);
    if (isAdminDatabaseAccessError(err)) {
      setResponseStatus(event, 409);
      return { success: false, message: "لا يمكن تعديل هذا الحقل من محرر قاعدة البيانات" };
    }
    if (isWalletWriteFenceError(err)) {
      setResponseStatus(event, 409);
      return { success: false, message: "لا يمكن تعديل أرصدة العملات مباشرة" };
    }
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر تحديث البيانات" };
  }
});
