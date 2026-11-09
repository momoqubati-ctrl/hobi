#!/usr/bin/env node

import { config } from "dotenv";
import { createJiti } from "jiti";
import { join } from "node:path";

config();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the explicit wallet opening migration.");
  }
  if (process.env.WALLET_BACKFILL_CONFIRM !== "legacy-opening-v1") {
    throw new Error("Set WALLET_BACKFILL_CONFIRM=legacy-opening-v1 to confirm this database cutover.");
  }

  const jiti = createJiti(import.meta.url);
  const { dbPool } = await jiti.import(join(process.cwd(), "server", "db", "index.ts"));
  const { ensureWalletLedgerSchema } = await jiti.import(join(process.cwd(), "server", "db", "migrate.ts"));
  const { runLegacyWalletBackfill } = await jiti.import(join(process.cwd(), "server", "db", "walletBackfill.ts"));
  const client = await dbPool.connect();

  try {
    await ensureWalletLedgerSchema(client);
    const result = await runLegacyWalletBackfill(client);
    console.log(result.alreadyApplied
      ? "Wallet opening migration was already applied."
      : `Wallet opening migration completed for ${result.totalCoins} coins.`);
  } finally {
    client.release();
    await dbPool.end();
  }
}

main().catch((error) => {
  console.error("Wallet opening migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
