#!/usr/bin/env node
/* eslint-disable no-console */

const { Pool } = require("pg");
require("dotenv").config();

const requiredTables = [
  "users",
  "user_profiles",
  "profile_visits",
  "user_verifications",
  "social_edges",
  "social_affinity",
  "identity_effects",
  "user_identity_state",
  "behavior_scores",
  "activity_stream",
  "rooms",
  "moderation_events",
  "site_settings",
  "voice_provider_accounts",
  "voice_provider_selection",
  "chat_bots",
  "moderation_filters",
  "admin_audit_logs",
  "wall_posts",
  "wall_comments",
  "wall_post_likes",
  "roles",
  "role_permissions",
  "user_role_assignments",
];

function getPool() {
  let connectionString = process.env.DATABASE_URL || "";
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }
  if (connectionString.includes("sslmode=")) {
    connectionString = connectionString.replace(/[?&]sslmode=[^&]+/, "");
  }

  return new Pool({
    connectionString,
    ssl: process.env.DATABASE_URL?.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
  });
}

async function main() {
  const pool = getPool();
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1);",
      [requiredTables],
    );

    const existingTables = result.rows.map((row) => row.table_name);
    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));

    console.log("Required tables status:");
    requiredTables.forEach((table) => {
      const status = existingTables.includes(table) ? "✅" : "❌";
      console.log(`${status} ${table}`);
    });

    if (missingTables.length > 0) {
      console.error("\nMissing required tables:", missingTables.join(", "));
      process.exitCode = 1;
    } else {
      console.log("\nAll required tables exist.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
