import { config } from "dotenv";
config();
import { dbPool } from "./server/db/index";

async function run() {
  try {
    const res = await dbPool.query(`
      SELECT id, username, topic, idreg, msg 
      FROM users
    `);
    console.log("Users in DB:", res.rows);
  } catch (err) {
    console.error("Error:", err);
  }
  process.exit(0);
}
run();

