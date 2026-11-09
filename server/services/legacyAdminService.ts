import { dbPool } from "../db";

const ADMIN_WRITE_DENIED_TABLES = new Set([
  "admin_audit_logs",
  "cash_accounts",
  "cash_entries",
  "cash_operations",
  "files",
  "gift_catalog",
  "gift_transactions",
  "member_coin_purchases",
  "roles",
  "role_permissions",
  "site_settings",
  "user_profiles",
  "user_role_assignments",
  "users",
  "wallet_agents",
  "wallet_agent_inventory_orders",
  "wallet_agent_packages",
  "wallet_settings",
  "wallet_operations",
  "wallet_balances",
  "wallet_entries",
]);

const ADMIN_READ_DENIED_TABLES = new Set([
  "admin_audit_logs",
  "files",
  "site_settings",
  "user_verifications",
  "voice_provider_accounts",
]);

const SENSITIVE_ADMIN_COLUMN_PATTERN =
  /password|token|secret|api.?key|proof|receipt|credential|private.?key|auth.?key|authorization/i;
const WALLET_FINANCIAL_TABLES = new Set([
  "wallet_agents",
  "wallet_settings",
  "wallet_operations",
  "wallet_balances",
  "wallet_entries",
]);

export class AdminDatabaseAccessError extends Error {
  constructor(readonly code:
    | "ADMIN_TABLE_READ_DENIED"
    | "ADMIN_TABLE_WRITE_DENIED"
    | "ADMIN_COLUMN_WRITE_DENIED") {
    super(code);
    this.name = "AdminDatabaseAccessError";
  }
}

export const isAdminDatabaseAccessError = (error: unknown) =>
  error instanceof AdminDatabaseAccessError;

export const isAdminTableWritable = (tableName: string) =>
  !ADMIN_WRITE_DENIED_TABLES.has(tableName.toLowerCase());

export const isAdminTableReadable = (tableName: string) =>
  !ADMIN_READ_DENIED_TABLES.has(tableName.toLowerCase());

export const isWalletFinancialTable = (tableName: string) =>
  WALLET_FINANCIAL_TABLES.has(tableName);

export const isAdminColumnVisible = (columnName: string) =>
  !SENSITIVE_ADMIN_COLUMN_PATTERN.test(columnName);

export const getVisibleAdminColumns = <T extends { name: string }>(columns: T[]) =>
  columns.filter((column) => isAdminColumnVisible(column.name));

export const isWalletWriteFenceError = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "55000";

export type AdminColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  maxLength: number | null;
};

export const tableExists = async (tableName: string) => {
  const result = await dbPool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
     LIMIT 1`,
    [tableName],
  );
  return result.rowCount > 0;
};

export const assertSafeTableName = (tableName: unknown) => {
  const value = String(tableName || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return "";
  return value;
};

const requireSafeTableName = (tableName: string) => {
  const safeTableName = assertSafeTableName(tableName);
  if (!safeTableName) throw new Error("Invalid table name");
  return safeTableName;
};

const assertReadableTable = (tableName: string) => {
  requireSafeTableName(tableName);
  if (!isAdminTableReadable(tableName)) {
    throw new AdminDatabaseAccessError("ADMIN_TABLE_READ_DENIED");
  }
};

export const listAdminTables = async () => {
  const tables = await dbPool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );

  const results = [];
  for (const row of tables.rows.filter(({ table_name }) => isAdminTableReadable(table_name))) {
    const countResult = await dbPool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${row.table_name}"`);
    results.push({
      name: row.table_name,
      rowCount: Number(countResult.rows[0]?.count || 0),
    });
  }
  return results;
};

export const listAdminColumns = async (tableName: string): Promise<AdminColumn[]> => {
  assertReadableTable(tableName);
  const result = await dbPool.query(
    `SELECT
       column_name AS "name",
       data_type AS "dataType",
       is_nullable = 'YES' AS "nullable",
       column_default AS "defaultValue",
       character_maximum_length AS "maxLength"
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
  );
  return getVisibleAdminColumns(result.rows);
};

export const listTableRows = async (tableName: string, limit = 50, offset = 0) => {
  const safeTableName = requireSafeTableName(tableName);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const columns = await listAdminColumns(tableName);
  if (columns.length === 0) return [];
  const selectColumns = columns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(", ");
  const result = await dbPool.query(
    `SELECT ${selectColumns} FROM "${safeTableName}" LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );
  return result.rows;
};

export const countTableRows = async (tableName: string) => {
  assertReadableTable(tableName);
  const safeTableName = requireSafeTableName(tableName);
  const result = await dbPool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${safeTableName}"`,
  );
  return Number(result.rows[0]?.count || 0);
};

export const getPrimaryKeyColumn = async (tableName: string): Promise<string> => {
  assertReadableTable(tableName);
  const safeTableName = requireSafeTableName(tableName);
  try {
    const result = await dbPool.query<{ name: string }>(
      `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [safeTableName]
    );
    return result.rows[0]?.name || "id";
  } catch {
    return "id";
  }
};

const isSafeIdentifier = (val: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val);

const assertWritableTable = (tableName: string) => {
  requireSafeTableName(tableName);
  if (!isAdminTableWritable(tableName)) {
    throw new AdminDatabaseAccessError("ADMIN_TABLE_WRITE_DENIED");
  }
};

const assertWritableColumns = async (tableName: string, columnNames: string[]) => {
  assertWritableTable(tableName);
  const allowedColumns = await listAdminColumns(tableName);
  const allowedColumnNames = new Set(allowedColumns.map(({ name }) => name));
  if (columnNames.some((columnName) => !allowedColumnNames.has(columnName))) {
    throw new AdminDatabaseAccessError("ADMIN_COLUMN_WRITE_DENIED");
  }
  return allowedColumns;
};

export const insertTableRow = async (tableName: string, data: Record<string, unknown>) => {
  const safeTableName = requireSafeTableName(tableName);
  assertWritableTable(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error("No safe fields to insert");
  if (keys.some((key) => !isSafeIdentifier(key))) {
    throw new AdminDatabaseAccessError("ADMIN_COLUMN_WRITE_DENIED");
  }
  const allowedColumns = await assertWritableColumns(tableName, keys);
  const values = keys.map(k => data[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const columns = keys.map(k => `"${k}"`).join(", ");
  const returningColumns = allowedColumns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(", ");
  
  const query = `INSERT INTO "${safeTableName}" (${columns}) VALUES (${placeholders}) RETURNING ${returningColumns}`;
  const result = await dbPool.query(query, values);
  return result.rows[0];
};

export const updateTableRow = async (
  tableName: string,
  pkColumn: string,
  pkValue: unknown,
  data: Record<string, unknown>,
) => {
  const safeTableName = requireSafeTableName(tableName);
  assertWritableTable(tableName);
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error("No safe fields to update");
  if (keys.some((key) => !isSafeIdentifier(key))) {
    throw new AdminDatabaseAccessError("ADMIN_COLUMN_WRITE_DENIED");
  }
  const allowedColumns = await assertWritableColumns(tableName, keys);
  if (!isSafeIdentifier(pkColumn)) throw new Error("Invalid primary key column");

  const values = keys.map(k => data[k]);
  const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
  values.push(pkValue);
  const pkPlaceholder = `$${values.length}`;
  const returningColumns = allowedColumns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(", ");
  
  const query = `UPDATE "${safeTableName}" SET ${setClause} WHERE "${pkColumn}" = ${pkPlaceholder} RETURNING ${returningColumns}`;
  const result = await dbPool.query(query, values);
  return result.rows[0];
};

export const deleteTableRow = async (tableName: string, pkColumn: string, pkValue: unknown) => {
  const safeTableName = requireSafeTableName(tableName);
  if (!isAdminTableWritable(tableName)) {
    throw new AdminDatabaseAccessError("ADMIN_TABLE_WRITE_DENIED");
  }
  if (!isSafeIdentifier(pkColumn)) throw new Error("Invalid primary key column");
  const query = `DELETE FROM "${safeTableName}" WHERE "${pkColumn}" = $1`;
  await dbPool.query(query, [pkValue]);
  return true;
};
