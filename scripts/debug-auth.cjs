const { Pool } = require("pg");
const { scryptSync, timingSafeEqual } = require("crypto");
require("dotenv").config();

async function main() {
  let cs = process.env.DATABASE_URL;
  cs = cs.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({ connectionString: cs, ssl: false });

  const r = await pool.query("SELECT * FROM users WHERE username = $1", ["Safarihost"]);
  const row = r.rows[0];
  console.log("Found:", !!row);
  if (!row) return;

  console.log("Columns:", Object.keys(row));
  console.log("password:", JSON.stringify(row.password));
  console.log("password_hash:", JSON.stringify(row.password_hash));
  console.log("power:", JSON.stringify(row.power));
  console.log("role:", row.role);
  console.log("display_name:", row.display_name);

  if (row.password_hash) {
    const stored = row.password_hash;
    const [salt, hash] = stored.split(":");
    const actual = scryptSync("Safari2026*-*-", salt, 64);
    const expected = Buffer.from(hash, "hex");
    const match = expected.length === actual.length && timingSafeEqual(expected, actual);
    console.log("Password verify result:", match);

    const actualWrong = scryptSync("wrongpassword", salt, 64);
    const matchWrong = expected.length === actualWrong.length && timingSafeEqual(expected, actualWrong);
    console.log("Wrong password verify:", matchWrong);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
