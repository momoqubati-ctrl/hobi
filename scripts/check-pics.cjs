const { Pool } = require("pg");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(`
      SELECT id, uid, username, topic, pic, pich
      FROM users
      ORDER BY idreg DESC
      LIMIT 20
    `);
    console.log("\n=== users.pic values (last 20 users) ===\n");
    for (const row of result.rows) {
      console.log(`idreg=${row.idreg} | username=${row.username} | pic="${row.pic}" | pich="${row.pich}"`);
    }

    const storyResult = await pool.query(`
      SELECT s.id, s.author_id, u.username, u.pic as user_pic
      FROM stories s
      LEFT JOIN users u ON u.id = s.author_id
      WHERE s.is_active = true AND s.expires_at > NOW()
      ORDER BY s.created_at DESC
      LIMIT 10
    `);
    console.log("\n=== Active stories with author pic ===\n");
    for (const row of storyResult.rows) {
      console.log(`story=${row.id} | author_id=${row.author_id} | username=${row.username} | user_pic="${row.user_pic}"`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
