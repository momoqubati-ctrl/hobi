import { runAutoMigrations, verifyDatabaseSchema } from "../db/migrate";

let migrationDone = false;

export default (nitroApp: any) => {
  if (migrationDone) return;
  migrationDone = true;

  void (async () => {
    try {
      const initialCheck = await verifyDatabaseSchema();
      if (initialCheck.missingTables.length > 0) {
        await runAutoMigrations();
        const finalCheck = await verifyDatabaseSchema();
        if (finalCheck.missingTables.length > 0) {
          console.warn("[DB] ⚠️ لا تزال هناك جداول ناقصة بعد الترحيل:", finalCheck.missingTables);
        } else if (process.env.MIGRATION_LOGS === "1") {
          console.log("[DB] ✅ تم التحقق من اكتمال المخطط بعد الترحيل");
        }
      } else if (process.env.MIGRATION_LOGS === "1") {
        console.log("[DB] ✅ المخطط مكتمل ولا توجد جداول ناقصة");
      }
    } catch (error) {
      console.warn("[DB] ⚠️ فشل فحص أو ترحيل المخطط:", error);
    }
  })();
};
