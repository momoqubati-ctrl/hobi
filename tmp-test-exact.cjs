const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5433/chat_app' });

const lid = "test" + Date.now();
const uid = "testuid" + Date.now();
const now = Date.now();
const token = "testtoken" + Date.now();
const power = "";
const displayName = "TestUser999";
const username = "testuser999";
const passwordHash = "testhash123";

console.log("lid:", lid);
console.log("uid:", uid);
console.log("now:", now);
console.log("power:", power);

pool.query(
  `INSERT INTO users
    (id, bg, mcol, ucol, evaluation, ico, ip, fp, lid, uid, msg, pic, pich, power, rep, topic, username, password, them, cover, gift_ico, gcol, lastssen, joinuser, coins, site_badge_id, site_badge, wall_post_likes, gifts_received_count, muted, documentationc)
   VALUES
    (gen_random_uuid(), '#FFFFFF', '#000000', '#000000', 0, '', '', '', $1, $2, '(عضو جديد)', 'pic.png', 'pich.png', $3, 0, $4, $5, $6, '', '', '', '#FFFFFF', $7, $7, 0, '', '', 0, 0, false, false)
   RETURNING *`,
  [lid, uid, power, displayName, username, passwordHash, String(now)]
).then(r => {
  console.log("SUCCESS!");
  console.log("Row id:", r.rows[0]?.id);
  console.log("Row username:", r.rows[0]?.username);
  console.log("Row uid:", r.rows[0]?.uid);
}).catch(e => {
  console.log("ERROR:", e.message);
  console.log("Stack:", e.stack?.split("\n").slice(0, 5).join("\n"));
}).finally(() => pool.end());
