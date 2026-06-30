import { config } from "dotenv";
config();
import { dbPool } from "./server/db/index";

async function test() {
  try {
    console.log("Running migration...");
    await dbPool.query("ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL");
    console.log("Migration executed successfully!");
  } catch (err: any) {
    console.error("Failed:", err);
  }
  process.exit(0);
}
test();
