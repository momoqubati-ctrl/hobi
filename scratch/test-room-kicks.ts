import { config } from "dotenv";
config();
import { dbPool } from "../server/db/index";

async function run() {
  try {
    const data = await dbPool.query("SELECT * FROM room_kicks;");
    console.log("ALL rows in room_kicks:", data.rows);
  } catch (err: any) {
    console.error("Error reading room_kicks:", err.message || err);
  }
  process.exit(0);
}
run();
