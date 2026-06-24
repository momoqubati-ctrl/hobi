#!/usr/bin/env node
const { randomUUID, scryptSync } = require("node:crypto");
const { Pool } = require("pg");
require("dotenv").config();

const username = "Safarihost";
const password = "Safari2026*-*-";

function hashPassword(value) {
  const salt = randomUUID().replaceAll("-", "");
  const hash = scryptSync(value, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  let connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/chat_app";
  if (connectionString.includes("sslmode=")) {
    connectionString = connectionString.replace(/[?&]sslmode=[^&]+/, "");
  }
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_URL?.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1)", [username]);

    if (existing.rowCount > 0) {
      const userId = existing.rows[0].id;
      await pool.query(
        `UPDATE users SET role = 'owner', password_hash = $1 WHERE id = $2`,
        [hashPassword(password), userId]
      );
      console.log(`User "${username}" updated to owner role (id: ${userId})`);
    } else {
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, username, display_name, role, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, 'owner', $4, NOW(), NOW())`,
        [userId, username, username, hashPassword(password)]
      );
      await pool.query(
        `INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
      console.log(`User "${username}" created as owner (id: ${userId})`);
    }

    console.log(`\nLogin with:\n  Username: ${username}\n  Password: ${password}`);
  } catch (err) {
    console.error("Error:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
