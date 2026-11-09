import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  assertSafeTableName,
  countTableRows,
  isAdminTableReadable,
  listAdminColumns,
  listAdminTables,
  listTableRows,
  tableExists,
  getPrimaryKeyColumn,
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
  const limit = Number(query.limit || 50);
  const offset = Number(query.offset || 0);

  try {
    const tables = await listAdminTables();

    if (!tableName) {
      return { success: true, tables, selectedTable: null, columns: [], rows: [], totalRows: 0, primaryKey: "id" };
    }

    if (!isAdminTableReadable(tableName)) {
      setResponseStatus(event, 403);
      return { success: false, message: "لا يمكن عرض هذا الجدول من محرر قاعدة البيانات" };
    }

    if (!(await tableExists(tableName))) {
      setResponseStatus(event, 404);
      return { success: false, message: "الجدول غير موجود" };
    }

    const [columns, rows, totalRows, pkColumn] = await Promise.all([
      listAdminColumns(tableName),
      listTableRows(tableName, limit, offset),
      countTableRows(tableName),
      getPrimaryKeyColumn(tableName),
    ]);

    return {
      success: true,
      tables,
      selectedTable: tableName,
      columns,
      rows,
      totalRows,
      primaryKey: pkColumn,
      limit: Math.min(Math.max(limit || 50, 1), 100),
      offset: Math.max(offset || 0, 0),
    };
  } catch (err) {
    console.error("Admin database browser error:", err);
    setResponseStatus(event, 500);
    return { success: false, message: "تعذر قراءة بيانات القاعدة" };
  }
});
