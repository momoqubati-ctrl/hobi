import {
  runAutoMigrations,
  verifyDatabaseSchema,
  ensureWalletOperationsMetadataColumn,
  ensureDefaultMemberRole,
  ensureSystemOwnerRole,
  ensureSiteOwnerAccount,
  ensureSiteOwnerRoleProtectionSchema,
  ensureChatFeaturePermissions,
  ensureAnnouncementDeliverySchema,
  ensurePrivateMessageStorageDisabled,
  ensureAdminGiftTabPermission,
  ensureRoomBadgesColumns,
  ensureUserProfilesColumns,
  ensureRoomAndMemberFeatures,
  ensureUserIdentityAndConsolidation,
} from "../db/migrate";
import { dbPool } from "../db";
import { redis } from "../services/redis";
import { getSiteOwnerBootstrapConfig } from "../services/siteOwner";

let migrationPromise: Promise<void> | null = null;
const VERSIONED_FINANCIAL_TABLES = new Set(["cash_accounts", "cash_operations", "cash_entries"]);

const initializeDatabase = async () => {
  try {
    const initialCheck = await verifyDatabaseSchema();
    if (
      initialCheck.missingTables.some((table) => VERSIONED_FINANCIAL_TABLES.has(table)) ||
      initialCheck.missingCashColumns.length > 0 ||
      initialCheck.missingCashGuards.length > 0
    ) {
      console.warn(
        "[DB] ⚠️ مخطط دفتر النقد غير مكتمل؛ يلزم تشغيل الترحيل المالي ذي الإصدار قبل استخدامه.",
        {
          tables: initialCheck.missingTables.filter((table) => VERSIONED_FINANCIAL_TABLES.has(table)),
          columns: initialCheck.missingCashColumns,
          guards: initialCheck.missingCashGuards,
        },
      );
    }

    const missingAutoMigrationTables = initialCheck.missingTables.filter(
      (table) => !VERSIONED_FINANCIAL_TABLES.has(table),
    );
    const requiresFullMigration =
      missingAutoMigrationTables.length > 0 || initialCheck.missingWalletGuards.length > 0;
    if (requiresFullMigration) {
      await runAutoMigrations();
    } else if (initialCheck.missingWalletColumns.length > 0) {
      const walletSchemaClient = await dbPool.connect();
      try {
        await ensureWalletOperationsMetadataColumn(walletSchemaClient);
      } finally {
        walletSchemaClient.release();
      }
    }

    if (requiresFullMigration || initialCheck.missingWalletColumns.length > 0) {
      const finalCheck = await verifyDatabaseSchema();
      if (
        finalCheck.missingTables.length > 0 ||
        finalCheck.missingWalletColumns.length > 0 ||
        finalCheck.missingWalletGuards.length > 0 ||
        finalCheck.missingCashColumns.length > 0 ||
        finalCheck.missingCashGuards.length > 0
      ) {
        console.warn("[DB] ⚠️ لا تزال هناك عناصر مخطط ناقصة بعد الترحيل:", {
          tables: finalCheck.missingTables,
          walletColumns: finalCheck.missingWalletColumns,
          walletGuards: finalCheck.missingWalletGuards,
          cashColumns: finalCheck.missingCashColumns,
          cashGuards: finalCheck.missingCashGuards,
        });
      } else if (process.env.MIGRATION_LOGS === "1") {
        console.log("[DB] ✅ تم التحقق من اكتمال المخطط بعد الترحيل");
      }
    } else if (process.env.MIGRATION_LOGS === "1") {
      console.log("[DB] ✅ المخطط مكتمل ولا توجد جداول ناقصة");
    }

    const privateMessageClient = await dbPool.connect();
    try {
      await ensurePrivateMessageStorageDisabled(privateMessageClient);
    } finally {
      privateMessageClient.release();
    }

    await ensureDefaultMemberRole();
    const siteOwnerProtectionClient = await dbPool.connect();
    try {
      await ensureSiteOwnerRoleProtectionSchema(siteOwnerProtectionClient);
    } finally {
      siteOwnerProtectionClient.release();
    }
    await ensureSystemOwnerRole();
    await ensureChatFeaturePermissions();
    const announcementMigrationClient = await dbPool.connect();
    try {
      await ensureAnnouncementDeliverySchema(announcementMigrationClient);
    } finally {
      announcementMigrationClient.release();
    }
    await ensureAdminGiftTabPermission();

    // تحديث جدول شارات الغرف بغض النظر عن حالة الترحيل
    await ensureRoomBadgesColumns();

    // تحديث جدول بروفايلات المستخدمين بالأعمدة الجديدة
    await ensureUserProfilesColumns();
    await ensureRoomAndMemberFeatures();
    await ensureUserIdentityAndConsolidation();
    const siteOwnerConfig = getSiteOwnerBootstrapConfig();
    if (siteOwnerConfig) {
      await ensureSiteOwnerAccount(siteOwnerConfig);
    } else {
      console.error("[SiteOwnerBootstrap] SITE_OWNER_USERNAME or SITE_OWNER_PASSWORD_HASH is missing or invalid; site-owner login remains unavailable.");
    }

    // مسح كاش الصلاحيات عند بدء التشغيل
    try {
      const keys = await redis.keys("permissions:*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (cacheErr) {
      // قد لا يكون Redis متاحاً
    }
  } catch (error) {
    console.warn("[DB] ⚠️ فشل فحص أو ترحيل المخطط:", error);
    throw error;
  }
};

export default () => {
  if (!migrationPromise) migrationPromise = initializeDatabase();
  return migrationPromise;
};
