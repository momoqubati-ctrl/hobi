#!/usr/bin/env node
const { Pool } = require("pg");
require("dotenv").config();

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
    const userRes = await pool.query("SELECT id FROM users WHERE username = 'Safarihost'");
    if (userRes.rowCount === 0) {
      console.error("User Safarihost not found");
      return;
    }
    const userId = userRes.rows[0].id;

    let roleRes = await pool.query("SELECT id FROM roles WHERE name = 'Owner' OR legacy_name = 'ispower' LIMIT 1");
    let roleId;
    if (roleRes.rowCount === 0) {
      const newRole = await pool.query(
        `INSERT INTO roles (legacy_name, name, rank, icon_url, is_system, auto_enabled, auto_promote, auto_points)
         VALUES ('ispower', 'Owner', 99999, '', true, false, false, 0)
         RETURNING id`
      );
      roleId = newRole.rows[0].id;
      console.log(`Created role 'Owner' (id: ${roleId})`);
    } else {
      roleId = roleRes.rows[0].id;
      console.log(`Found existing role (id: ${roleId})`);
    }

    const perms = ["cp", "ban", "kick", "edituser", "setpower", "delmsg", "delbc", "flter", "shrt", "subs", "stealth", "history", "forcepm", "grupes", "createroom", "roomowner", "meiut", "loveu", "delpic", "ulike", "unick", "publicmsg"];
    for (const perm of perms) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, permission_value)
         VALUES ($1, $2, 'true'::jsonb)
         ON CONFLICT (role_id, permission_key) DO NOTHING`,
        [roleId, perm]
      );
    }
    console.log(`Assigned ${perms.length} permissions to role`);

    await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, starts_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [userId, roleId]
    );
    console.log(`Assigned role to user ${userId}`);

    console.log("\n✅ Admin setup complete! Restart the server and refresh the page.");
  } catch (err) {
    console.error("Error:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
