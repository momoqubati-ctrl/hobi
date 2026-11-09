import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Initialize database connection
let connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/chat_app";

// Strip sslmode from connection string to avoid conflicts with the ssl object
if (connectionString.includes("sslmode=")) {
  connectionString = connectionString.replace(/[?&]sslmode=[^&]+/, "");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL?.includes("supabase.com")
    ? { rejectUnauthorized: false }
    : undefined,
  // Keep each application instance within a conservative database connection budget.
  max: Number(process.env.DB_POOL_MAX ?? 10),
  min: Number(process.env.DB_POOL_MIN ?? 0),
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 15_000),
  allowExitOnIdle: false,
});

export const db = drizzle(pool, { schema });
export const dbPool = pool;

export const checkDatabaseConnection = async () => {
  try {
    await pool.query("select 1");
    return {
      connected: true,
      message: "قاعدة البيانات متصلة",
    };
  } catch {
    return {
      connected: false,
      message: "قاعدة البيانات غير متصلة",
    };
  }
};
