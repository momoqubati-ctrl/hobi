import { dbPool } from "./index";
import type { PoolClient } from "pg";
import {
  DEFAULT_MEMBER_ROLE_LABEL,
  DEFAULT_MEMBER_ROLE_NAME,
  DEFAULT_MEMBER_ROLE_PERMISSIONS,
} from "../services/defaultMemberRole";
import { RESOURCE_ACTIONS } from "../services/permissionEngine";
import {
  SYSTEM_OWNER_RANK,
  SYSTEM_OWNER_ROLE_NAME,
  SYSTEM_OWNER_USERNAME,
} from "../services/systemOwner";
import {
  SITE_OWNER_ROLE_NAME,
  getSiteOwnerPermissionKeys,
  type SiteOwnerBootstrapConfig,
} from "../services/siteOwner";
import { ensureSiteOwnerBootstrap } from "../services/siteOwnerBootstrap";
import { DEFAULT_CHAT_FEATURE_PERMISSION_KEYS } from "../../src/lib/chatFeaturePermissions";

export async function ensureAnnouncementRoleLimitSchema(client: PoolClient) {
  await client.query(`
    ALTER TABLE "roles"
    ADD COLUMN IF NOT EXISTS "announcement_daily_limit" integer DEFAULT 0 NOT NULL
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'roles_announcement_daily_limit_check'
          AND conrelid = 'roles'::regclass
      ) THEN
        ALTER TABLE "roles"
        ADD CONSTRAINT "roles_announcement_daily_limit_check"
        CHECK ("announcement_daily_limit" BETWEEN 0 AND 1000);
      END IF;
    END
    $$;
  `);
}

export async function ensureAnnouncementDeliverySchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "announcements" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "type" varchar(16) NOT NULL,
      "message" varchar(1000) NOT NULL,
      "sender_user_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
      "sender_name" varchar(120) NOT NULL,
      "sender_avatar_url" text,
      "room_id" varchar(128),
      "created_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "announcements_type_check"
        CHECK ("type" IN ('all', 'ranked', 'room')),
      CONSTRAINT "announcements_message_length_check"
        CHECK (length(trim("message")) BETWEEN 1 AND 1000)
    );
    CREATE INDEX IF NOT EXISTS "announcements_created_idx"
      ON "announcements" ("created_at", "id");
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "announcement_recipients" (
      "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
      "recipient_user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "delivered_at" timestamptz DEFAULT now() NOT NULL,
      PRIMARY KEY ("announcement_id", "recipient_user_id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "announcement_recipients_user_idx"
      ON "announcement_recipients" ("recipient_user_id", "announcement_id");
    CREATE INDEX IF NOT EXISTS "announcement_recipients_announcement_idx"
      ON "announcement_recipients" ("announcement_id");
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "announcement_daily_usage" (
      "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "usage_date" varchar(10) NOT NULL,
      "send_count" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      PRIMARY KEY ("user_id", "usage_date"),
      CONSTRAINT "announcement_daily_usage_nonnegative_check"
        CHECK ("send_count" >= 0)
    );
    CREATE INDEX IF NOT EXISTS "announcement_daily_usage_date_idx"
      ON "announcement_daily_usage" ("usage_date");
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "announcement_idempotency" (
      "sender_user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "idempotency_key" uuid NOT NULL,
      "request_fingerprint" varchar(64) NOT NULL,
      "announcement_id" uuid REFERENCES "announcements"("id") ON DELETE SET NULL,
      "response" jsonb NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "expires_at" timestamptz NOT NULL,
      PRIMARY KEY ("sender_user_id", "idempotency_key"),
      CONSTRAINT "announcement_idempotency_fingerprint_check"
        CHECK (length("request_fingerprint") = 64)
    );
    CREATE INDEX IF NOT EXISTS "announcement_idempotency_expiry_idx"
      ON "announcement_idempotency" ("expires_at");
  `);
}

export async function ensureWalletOperationsMetadataColumn(
  client: Pick<PoolClient, "query">,
) {
  await client.query(`
    ALTER TABLE "wallet_operations"
    ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
  `);
}

export async function ensurePrivateMessageStorageDisabled(
  client: Pick<PoolClient, "query">,
) {
  const table = await client.query(
    `SELECT to_regclass('public.private_messages')::text AS table_name`,
  );
  if (!table.rows[0]?.table_name) {
    throw new Error("Cannot disable persistent private messaging: private_messages table is missing");
  }

  await client.query(`
    CREATE OR REPLACE FUNCTION public.reject_private_message_persistence()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'Persistent private-message storage is disabled'
        USING ERRCODE = '55000';
    END;
    $$
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'private_messages_ephemeral_only'
          AND tgrelid = 'public.private_messages'::regclass
          AND NOT tgisinternal
      ) THEN
        CREATE TRIGGER private_messages_ephemeral_only
          BEFORE INSERT OR UPDATE ON public.private_messages
          FOR EACH ROW
          EXECUTE FUNCTION public.reject_private_message_persistence();
      END IF;
    END;
    $$
  `);
}

export async function removePrivateMessageStorageGuard(
  client: Pick<PoolClient, "query">,
) {
  await client.query(
    `DROP TRIGGER IF EXISTS private_messages_ephemeral_only ON public.private_messages`,
  );
  await client.query(
    `DROP FUNCTION IF EXISTS public.reject_private_message_persistence()`,
  );
}

async function applyDefaultMemberRoleMigration(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "roles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "legacy_name" varchar(120),
      "name" varchar(120) NOT NULL,
      "rank" integer DEFAULT 0 NOT NULL,
      "icon_url" text DEFAULT '' NOT NULL,
      "is_system" boolean DEFAULT false NOT NULL,
      "is_default" boolean DEFAULT false NOT NULL,
      "is_owner" boolean DEFAULT false NOT NULL,
      "auto_enabled" boolean DEFAULT false NOT NULL,
      "auto_promote" boolean DEFAULT false NOT NULL,
      "auto_points" integer DEFAULT 0 NOT NULL,
      "announcement_daily_limit" integer DEFAULT 0 NOT NULL,
      "legacy_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "roles_announcement_daily_limit_check"
        CHECK ("announcement_daily_limit" BETWEEN 0 AND 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_idx" ON "roles" ("name");
    CREATE INDEX IF NOT EXISTS "roles_rank_idx" ON "roles" ("rank");
  `);
  await client.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;`);
  await client.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "is_owner" boolean DEFAULT false NOT NULL;`);
  await client.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;`);
  await ensureAnnouncementRoleLimitSchema(client);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "roles_single_default_idx" ON "roles" ("is_default") WHERE "is_default" = true;`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "role_permissions" (
      "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "permission_key" varchar(120) NOT NULL,
      "permission_value" jsonb DEFAULT 'true'::jsonb NOT NULL,
      "source" varchar(40) DEFAULT 'legacy_powers' NOT NULL,
      PRIMARY KEY ("role_id", "permission_key")
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "user_role_assignments" (
      "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
      "assigned_by" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
      "starts_at" timestamptz DEFAULT now() NOT NULL,
      "expires_at" timestamptz,
      "legacy_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      PRIMARY KEY ("user_id", "role_id")
    );
  `);
  await client.query(
    `INSERT INTO "roles" ("legacy_name", "name", "rank", "is_system", "is_default")
     SELECT $1, $2, 1000, true, true
     WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "is_default" = true)
     ON CONFLICT ("name") DO UPDATE SET "is_system" = true, "is_default" = true`,
    [DEFAULT_MEMBER_ROLE_LABEL, DEFAULT_MEMBER_ROLE_NAME],
  );

  for (const permissionKey of DEFAULT_MEMBER_ROLE_PERMISSIONS) {
    await client.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source")
       SELECT "id", $1, 'true'::jsonb, 'default_member'
       FROM "roles"
       WHERE "is_default" = true
       ON CONFLICT ("role_id", "permission_key") DO NOTHING`,
      [permissionKey],
    );
  }

  await client.query(
    `INSERT INTO "user_role_assignments" ("user_id", "role_id", "legacy_metadata")
     SELECT u."id"::text, r."id", jsonb_build_object('source', 'default_member_backfill')
     FROM "users" u
     CROSS JOIN "roles" r
     WHERE r."is_default" = true
       AND r."is_active" = true
       AND u."role" = 'member'
       AND lower(trim(COALESCE(u."power", ''))) IN ('', 'member', 'عضو')
       AND NOT EXISTS (
         SELECT 1 FROM "user_role_assignments" existing
         WHERE existing."user_id" = u."id"::text
       )
     ON CONFLICT ("user_id", "role_id") DO NOTHING`,
  );
}

export async function ensureWalletLedgerSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "wallet_agents" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "username" varchar(64) NOT NULL,
      "name" varchar(120) NOT NULL,
      "phone" varchar(16) DEFAULT '' NOT NULL,
      "password_hash" text NOT NULL,
      "status" varchar(16) DEFAULT 'active' NOT NULL,
      "force_password_change" boolean DEFAULT true NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "wallet_agents_username_lowercase_check" CHECK ("username" = lower("username")),
      CONSTRAINT "wallet_agents_status_check" CHECK ("status" IN ('active', 'disabled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_agents_username_idx" ON "wallet_agents" ("username");

    CREATE TABLE IF NOT EXISTS "wallet_settings" (
      "key" varchar(120) PRIMARY KEY,
      "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "updated_by" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "wallet_operations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_scope" varchar(16) NOT NULL,
      "actor_user_id" varchar(255) REFERENCES "users"("id") ON DELETE RESTRICT,
      "operation_type" varchar(40) NOT NULL,
      "idempotency_key" varchar(128) NOT NULL,
      "request_fingerprint" varchar(64) NOT NULL,
      "reference_type" varchar(40),
      "reference_id" varchar(255),
      "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "wallet_operations_actor_scope_check"
        CHECK ("actor_scope" IN ('member', 'system') AND ("actor_scope" <> 'system' OR "actor_user_id" IS NULL)),
      CONSTRAINT "wallet_operations_fingerprint_format_check"
        CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "wallet_operations_idempotency_key_check"
        CHECK (length(trim("idempotency_key")) > 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_actor_idempotency_idx"
      ON "wallet_operations" ("actor_user_id", "idempotency_key")
      WHERE "actor_scope" = 'member' AND "actor_user_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_system_idempotency_idx"
      ON "wallet_operations" ("idempotency_key")
      WHERE "actor_scope" = 'system';
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_site_funding_reference_idx"
      ON "wallet_operations" (lower("reference_id"))
      WHERE "reference_type" = 'site_wallet_funding' AND "reference_id" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "wallet_operations_reference_idx"
      ON "wallet_operations" ("reference_type", "reference_id");
    CREATE INDEX IF NOT EXISTS "wallet_operations_created_idx"
      ON "wallet_operations" ("created_at");

    CREATE TABLE IF NOT EXISTS "wallet_balances" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "account_type" varchar(16) NOT NULL,
      "user_id" varchar(255) REFERENCES "users"("id") ON DELETE RESTRICT,
      "bucket" varchar(40) NOT NULL,
      "balance_coins" bigint DEFAULT 0 NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "wallet_balances_bucket_check"
        CHECK (
          ("account_type" = 'member' AND "bucket" IN ('legacy_spendable', 'cashable_spendable', 'cashable_reserved'))
          OR
          ("account_type" = 'system' AND "user_id" IS NULL AND "bucket" IN ('platform_fee', 'external_clearing', 'legacy_opening_equity', 'site_inventory'))
        ),
      CONSTRAINT "wallet_balances_member_nonnegative_check"
        CHECK ("account_type" <> 'member' OR "balance_coins" >= 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_balances_member_bucket_idx"
      ON "wallet_balances" ("user_id", "bucket")
      WHERE "account_type" = 'member' AND "user_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_balances_system_bucket_idx"
      ON "wallet_balances" ("bucket")
      WHERE "account_type" = 'system';
    CREATE INDEX IF NOT EXISTS "wallet_balances_user_idx" ON "wallet_balances" ("user_id");

    CREATE TABLE IF NOT EXISTS "wallet_entries" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "operation_id" uuid NOT NULL REFERENCES "wallet_operations"("id") ON DELETE RESTRICT,
      "wallet_balance_id" uuid NOT NULL REFERENCES "wallet_balances"("id") ON DELETE RESTRICT,
      "amount" bigint NOT NULL,
      "reversal_of_entry_id" uuid REFERENCES "wallet_entries"("id") ON DELETE RESTRICT,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "wallet_entries_nonzero_amount_check" CHECK ("amount" <> 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_entries_operation_account_idx"
      ON "wallet_entries" ("operation_id", "wallet_balance_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_entries_reversal_once_idx"
      ON "wallet_entries" ("reversal_of_entry_id")
      WHERE "reversal_of_entry_id" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "wallet_entries_operation_idx" ON "wallet_entries" ("operation_id");
    CREATE INDEX IF NOT EXISTS "wallet_entries_balance_idx" ON "wallet_entries" ("wallet_balance_id");
  `);
  await client.query(`
    DO $$
    DECLARE
      wallet_user_att smallint;
      operation_actor_att smallint;
      existing_fk record;
      has_restrictive_fk boolean;
    BEGIN
      SELECT attnum INTO wallet_user_att
      FROM pg_attribute
      WHERE attrelid = 'public.wallet_balances'::regclass
        AND attname = 'user_id'
        AND NOT attisdropped;

      SELECT attnum INTO operation_actor_att
      FROM pg_attribute
      WHERE attrelid = 'public.wallet_operations'::regclass
        AND attname = 'actor_user_id'
        AND NOT attisdropped;

      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.wallet_balances'::regclass
          AND confrelid = 'public.users'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[wallet_user_att]::smallint[]
          AND confdeltype = 'r'
      ) INTO has_restrictive_fk;

      IF NOT has_restrictive_fk THEN
        FOR existing_fk IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'public.wallet_balances'::regclass
            AND confrelid = 'public.users'::regclass
            AND contype = 'f'
            AND conkey = ARRAY[wallet_user_att]::smallint[]
        LOOP
          EXECUTE format(
            'ALTER TABLE public.wallet_balances DROP CONSTRAINT %I',
            existing_fk.conname
          );
        END LOOP;

        ALTER TABLE public.wallet_balances
          ADD CONSTRAINT "wallet_balances_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES public.users("id") ON DELETE RESTRICT;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.wallet_operations'::regclass
          AND confrelid = 'public.users'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[operation_actor_att]::smallint[]
          AND confdeltype = 'r'
      ) INTO has_restrictive_fk;

      IF NOT has_restrictive_fk THEN
        FOR existing_fk IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'public.wallet_operations'::regclass
            AND confrelid = 'public.users'::regclass
            AND contype = 'f'
            AND conkey = ARRAY[operation_actor_att]::smallint[]
        LOOP
          EXECUTE format(
            'ALTER TABLE public.wallet_operations DROP CONSTRAINT %I',
            existing_fk.conname
          );
        END LOOP;

        ALTER TABLE public.wallet_operations
          ADD CONSTRAINT "wallet_operations_actor_user_id_users_id_fk"
          FOREIGN KEY ("actor_user_id") REFERENCES public.users("id") ON DELETE RESTRICT;
      END IF;
    END;
    $$;
  `);
  await ensureWalletOperationsMetadataColumn(client);
  await client.query(`
    DO $$
    DECLARE
      bucket_constraint text;
    BEGIN
      SELECT pg_get_constraintdef(oid)
        INTO bucket_constraint
        FROM pg_constraint
        WHERE conname = 'wallet_balances_bucket_check'
          AND conrelid = 'public.wallet_balances'::regclass;

      IF bucket_constraint IS NULL OR position('site_inventory' IN bucket_constraint) = 0 THEN
        ALTER TABLE "wallet_balances"
          DROP CONSTRAINT IF EXISTS "wallet_balances_bucket_check";
        ALTER TABLE "wallet_balances"
          ADD CONSTRAINT "wallet_balances_bucket_check"
          CHECK (
            ("account_type" = 'member' AND "bucket" IN ('legacy_spendable', 'cashable_spendable', 'cashable_reserved'))
            OR
            ("account_type" = 'system' AND "user_id" IS NULL AND "bucket" IN ('platform_fee', 'external_clearing', 'legacy_opening_equity', 'site_inventory'))
          );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wallet_balances_site_inventory_nonnegative_check'
          AND conrelid = 'public.wallet_balances'::regclass
      ) THEN
        ALTER TABLE "wallet_balances"
          ADD CONSTRAINT "wallet_balances_site_inventory_nonnegative_check"
          CHECK ("account_type" <> 'system' OR "bucket" <> 'site_inventory' OR "balance_coins" >= 0);
      END IF;
    END;
    $$;
  `);
  await client.query(`
    INSERT INTO "wallet_balances" ("account_type", "user_id", "bucket", "balance_coins")
    VALUES
      ('system', NULL, 'site_inventory', 0),
      ('system', NULL, 'external_clearing', 0)
    ON CONFLICT ("bucket") WHERE "account_type" = 'system' DO NOTHING
  `);
  await client.query(`
    ALTER TABLE "wallet_agents"
    ADD COLUMN IF NOT EXISTS "phone" varchar(16) DEFAULT '' NOT NULL
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION "prevent_wallet_record_mutation"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
        AND TG_TABLE_NAME = 'wallet_operations'
        AND OLD."actor_user_id" IS NOT NULL
        AND NEW."actor_user_id" IS NULL
        AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'wallet financial records are append-only'
        USING ERRCODE = '55000';
    END;
    $$;

    CREATE OR REPLACE FUNCTION "prevent_legacy_coin_writes_after_wallet_cutover"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF EXISTS (
          SELECT 1
          FROM "wallet_operations"
          WHERE "actor_scope" = 'system'
            AND "operation_type" = 'legacy_opening'
            AND "idempotency_key" = 'legacy-opening-v1'
        ) THEN
        IF TG_OP = 'UPDATE' AND NEW."coins" IS DISTINCT FROM OLD."coins" THEN
          RAISE EXCEPTION 'legacy coin balances are read-only after wallet cutover'
            USING ERRCODE = '55000';
        ELSIF TG_OP = 'INSERT' AND COALESCE(NEW."coins", 0) <> 0 THEN
          RAISE EXCEPTION 'legacy coin balances are read-only after wallet cutover'
            USING ERRCODE = '55000';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'wallet_operations_immutable'
          AND tgrelid = 'public.wallet_operations'::regclass
      ) THEN
        CREATE TRIGGER "wallet_operations_immutable"
          BEFORE UPDATE OR DELETE ON "wallet_operations"
          FOR EACH ROW EXECUTE FUNCTION "prevent_wallet_record_mutation"();
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'wallet_operations_no_truncate'
          AND tgrelid = 'public.wallet_operations'::regclass
      ) THEN
        CREATE TRIGGER "wallet_operations_no_truncate"
          BEFORE TRUNCATE ON "wallet_operations"
          FOR EACH STATEMENT EXECUTE FUNCTION "prevent_wallet_record_mutation"();
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'wallet_entries_immutable'
          AND tgrelid = 'public.wallet_entries'::regclass
      ) THEN
        CREATE TRIGGER "wallet_entries_immutable"
          BEFORE UPDATE OR DELETE ON "wallet_entries"
          FOR EACH ROW EXECUTE FUNCTION "prevent_wallet_record_mutation"();
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'wallet_entries_no_truncate'
          AND tgrelid = 'public.wallet_entries'::regclass
      ) THEN
        CREATE TRIGGER "wallet_entries_no_truncate"
          BEFORE TRUNCATE ON "wallet_entries"
          FOR EACH STATEMENT EXECUTE FUNCTION "prevent_wallet_record_mutation"();
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'user_profiles_legacy_coins_update_fence'
          AND tgrelid = 'public.user_profiles'::regclass
      ) THEN
        CREATE TRIGGER "user_profiles_legacy_coins_update_fence"
          BEFORE UPDATE OF "coins" ON "user_profiles"
          FOR EACH ROW EXECUTE FUNCTION "prevent_legacy_coin_writes_after_wallet_cutover"();
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'user_profiles_legacy_coins_insert_fence'
          AND tgrelid = 'public.user_profiles'::regclass
      ) THEN
        CREATE TRIGGER "user_profiles_legacy_coins_insert_fence"
          BEFORE INSERT ON "user_profiles"
          FOR EACH ROW EXECUTE FUNCTION "prevent_legacy_coin_writes_after_wallet_cutover"();
      END IF;
    END;
    $$;
  `);
}

export async function ensureCoinPurchaseSchema(client: PoolClient) {
  await client.query(`
    ALTER TABLE "wallet_balances" ADD COLUMN IF NOT EXISTS "agent_id" uuid;
    ALTER TABLE "wallet_operations" ADD COLUMN IF NOT EXISTS "actor_agent_id" uuid;
    ALTER TABLE "wallet_balances"
      DROP CONSTRAINT IF EXISTS "wallet_balances_agent_id_fkey";
    ALTER TABLE "wallet_balances"
      ADD CONSTRAINT "wallet_balances_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "wallet_agents"("id") ON DELETE RESTRICT;
    ALTER TABLE "wallet_operations"
      DROP CONSTRAINT IF EXISTS "wallet_operations_actor_agent_id_fkey";
    ALTER TABLE "wallet_operations"
      ADD CONSTRAINT "wallet_operations_actor_agent_id_fkey"
      FOREIGN KEY ("actor_agent_id") REFERENCES "wallet_agents"("id") ON DELETE RESTRICT;
  `);

  await client.query(`
    ALTER TABLE "wallet_operations"
      DROP CONSTRAINT IF EXISTS "wallet_operations_actor_scope_check";
    ALTER TABLE "wallet_operations"
      ADD CONSTRAINT "wallet_operations_actor_scope_check"
      CHECK (
        ("actor_scope" = 'member' AND "actor_agent_id" IS NULL)
        OR
        ("actor_scope" = 'agent' AND "actor_user_id" IS NULL AND "actor_agent_id" IS NOT NULL)
        OR
        ("actor_scope" = 'system' AND "actor_user_id" IS NULL AND "actor_agent_id" IS NULL)
      );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_agent_idempotency_idx"
      ON "wallet_operations" ("actor_agent_id", "idempotency_key")
      WHERE "actor_scope" = 'agent' AND "actor_agent_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_agent_inventory_reference_idx"
      ON "wallet_operations" ("reference_id")
      WHERE "reference_type" = 'agent_inventory_order' AND "reference_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_member_coin_purchase_reference_idx"
      ON "wallet_operations" ("reference_id")
      WHERE "reference_type" = 'member_coin_purchase' AND "reference_id" IS NOT NULL;
  `);

  await client.query(`
    ALTER TABLE "wallet_balances"
      DROP CONSTRAINT IF EXISTS "wallet_balances_bucket_check";
    ALTER TABLE "wallet_balances"
      ADD CONSTRAINT "wallet_balances_bucket_check"
      CHECK (
        ("account_type" = 'member' AND "agent_id" IS NULL
          AND "bucket" IN ('legacy_spendable', 'cashable_spendable', 'cashable_reserved'))
        OR
        ("account_type" = 'agent' AND "user_id" IS NULL AND "agent_id" IS NOT NULL
          AND "bucket" = 'agent_inventory')
        OR
        ("account_type" = 'system' AND "user_id" IS NULL AND "agent_id" IS NULL
          AND "bucket" IN ('platform_fee', 'external_clearing', 'legacy_opening_equity', 'site_inventory'))
      );
    ALTER TABLE "wallet_balances"
      DROP CONSTRAINT IF EXISTS "wallet_balances_agent_inventory_nonnegative_check";
    ALTER TABLE "wallet_balances"
      ADD CONSTRAINT "wallet_balances_agent_inventory_nonnegative_check"
      CHECK ("account_type" <> 'agent' OR "balance_coins" >= 0);
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_balances_agent_inventory_idx"
      ON "wallet_balances" ("agent_id", "bucket")
      WHERE "account_type" = 'agent' AND "agent_id" IS NOT NULL;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS "wallet_agent_packages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "agent_id" uuid NOT NULL REFERENCES "wallet_agents"("id") ON DELETE RESTRICT,
      "coin_amount" bigint NOT NULL,
      "price_minor_units" bigint NOT NULL,
      "currency_code" varchar(3) NOT NULL,
      "payment_instructions" text NOT NULL,
      "is_active" boolean DEFAULT true NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "wallet_agent_packages_coin_amount_check" CHECK ("coin_amount" > 0),
      CONSTRAINT "wallet_agent_packages_price_check" CHECK ("price_minor_units" > 0),
      CONSTRAINT "wallet_agent_packages_currency_check" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
      CONSTRAINT "wallet_agent_packages_instructions_length_check"
        CHECK (length(trim("payment_instructions")) BETWEEN 1 AND 4000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_agent_packages_agent_amount_idx"
      ON "wallet_agent_packages" ("agent_id", "coin_amount");
    CREATE INDEX IF NOT EXISTS "wallet_agent_packages_active_idx"
      ON "wallet_agent_packages" ("agent_id", "is_active");

    CREATE TABLE IF NOT EXISTS "wallet_agent_inventory_orders" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "agent_id" uuid NOT NULL REFERENCES "wallet_agents"("id") ON DELETE RESTRICT,
      "requested_coins" bigint NOT NULL,
      "quoted_price_minor_units" bigint,
      "currency_code" varchar(3),
      "payment_instructions_snapshot" text,
      "payment_reference" varchar(255),
      "proof_object_key" text,
      "proof_uploaded_at" timestamptz,
      "receipt_expires_at" timestamptz,
      "settlement_operation_id" uuid REFERENCES "wallet_operations"("id") ON DELETE RESTRICT,
      "quoted_by_user_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
      "quoted_at" timestamptz,
      "status" varchar(24) DEFAULT 'requested' NOT NULL,
      "idempotency_key" varchar(128) NOT NULL,
      "request_fingerprint" varchar(64) NOT NULL,
      "reviewed_by_user_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
      "reviewed_at" timestamptz,
      "rejection_reason" varchar(500),
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "wallet_agent_inventory_orders_coins_check" CHECK ("requested_coins" > 0),
      CONSTRAINT "wallet_agent_inventory_orders_price_check"
        CHECK ("quoted_price_minor_units" IS NULL OR "quoted_price_minor_units" > 0),
      CONSTRAINT "wallet_agent_inventory_orders_currency_check"
        CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$'),
      CONSTRAINT "wallet_agent_inventory_orders_quote_check"
        CHECK (
          "status" IN ('requested', 'rejected')
          OR (
            "quoted_price_minor_units" IS NOT NULL
            AND "currency_code" IS NOT NULL
            AND "payment_instructions_snapshot" IS NOT NULL
            AND length(trim("payment_instructions_snapshot")) BETWEEN 1 AND 4000
          )
        ),
      CONSTRAINT "wallet_agent_inventory_orders_status_check"
        CHECK ("status" IN ('requested', 'quoted', 'submitted', 'approved', 'rejected')),
      CONSTRAINT "wallet_agent_inventory_orders_payment_proof_check"
        CHECK (
          "status" NOT IN ('submitted', 'approved')
          OR ("payment_reference" IS NOT NULL AND "proof_object_key" IS NOT NULL)
        ),
      CONSTRAINT "wallet_agent_inventory_orders_fingerprint_check"
        CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$')
    );
    ALTER TABLE "wallet_agent_inventory_orders"
      ADD COLUMN IF NOT EXISTS "proof_uploaded_at" timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_agent_inventory_orders_agent_idempotency_idx"
      ON "wallet_agent_inventory_orders" ("agent_id", "idempotency_key");
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_agent_inventory_orders_payment_reference_idx"
      ON "wallet_agent_inventory_orders" (lower("payment_reference"))
      WHERE "payment_reference" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_agent_inventory_orders_settlement_idx"
      ON "wallet_agent_inventory_orders" ("settlement_operation_id")
      WHERE "settlement_operation_id" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "wallet_agent_inventory_orders_agent_status_idx"
      ON "wallet_agent_inventory_orders" ("agent_id", "status", "created_at");
    CREATE INDEX IF NOT EXISTS "wallet_agent_inventory_orders_receipt_expiry_idx"
      ON "wallet_agent_inventory_orders" ("receipt_expires_at");

    CREATE TABLE IF NOT EXISTS "member_coin_purchases" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "member_user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
      "agent_id" uuid NOT NULL REFERENCES "wallet_agents"("id") ON DELETE RESTRICT,
      "package_id" uuid NOT NULL REFERENCES "wallet_agent_packages"("id") ON DELETE RESTRICT,
      "coin_amount" bigint NOT NULL,
      "price_minor_units" bigint NOT NULL,
      "currency_code" varchar(3) NOT NULL,
      "payment_instructions_snapshot" text NOT NULL,
      "payment_reference" varchar(255),
      "proof_object_key" text,
      "proof_uploaded_at" timestamptz,
      "receipt_expires_at" timestamptz,
      "settlement_operation_id" uuid REFERENCES "wallet_operations"("id") ON DELETE RESTRICT,
      "status" varchar(24) DEFAULT 'awaiting_payment' NOT NULL,
      "idempotency_key" varchar(128) NOT NULL,
      "request_fingerprint" varchar(64) NOT NULL,
      "reviewed_by_agent_id" uuid REFERENCES "wallet_agents"("id") ON DELETE RESTRICT,
      "reviewed_at" timestamptz,
      "rejection_reason" varchar(500),
      "created_at" timestamptz DEFAULT now() NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "member_coin_purchases_coin_amount_check" CHECK ("coin_amount" > 0),
      CONSTRAINT "member_coin_purchases_price_check" CHECK ("price_minor_units" > 0),
      CONSTRAINT "member_coin_purchases_currency_check" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
      CONSTRAINT "member_coin_purchases_status_check"
        CHECK ("status" IN ('awaiting_payment', 'submitted', 'approved', 'rejected')),
      CONSTRAINT "member_coin_purchases_payment_proof_check"
        CHECK (
          "status" IN ('awaiting_payment', 'rejected')
          OR ("payment_reference" IS NOT NULL AND "proof_object_key" IS NOT NULL)
        ),
      CONSTRAINT "member_coin_purchases_fingerprint_check"
        CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$')
    );
    ALTER TABLE "member_coin_purchases"
      ADD COLUMN IF NOT EXISTS "proof_uploaded_at" timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS "member_coin_purchases_member_idempotency_idx"
      ON "member_coin_purchases" ("member_user_id", "idempotency_key");
    CREATE UNIQUE INDEX IF NOT EXISTS "member_coin_purchases_agent_payment_reference_idx"
      ON "member_coin_purchases" ("agent_id", lower("payment_reference"))
      WHERE "payment_reference" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "member_coin_purchases_settlement_idx"
      ON "member_coin_purchases" ("settlement_operation_id")
      WHERE "settlement_operation_id" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "member_coin_purchases_member_status_idx"
      ON "member_coin_purchases" ("member_user_id", "status", "created_at");
    CREATE INDEX IF NOT EXISTS "member_coin_purchases_agent_status_idx"
      ON "member_coin_purchases" ("agent_id", "status", "created_at");
    CREATE INDEX IF NOT EXISTS "member_coin_purchases_receipt_expiry_idx"
      ON "member_coin_purchases" ("receipt_expires_at");
  `);
}

export async function ensureFinancialWalletAccountsSchema(client: PoolClient) {
  await client.query(`
    ALTER TABLE "wallet_balances"
      DROP CONSTRAINT IF EXISTS "wallet_balances_bucket_check";
    ALTER TABLE "wallet_balances"
      ADD CONSTRAINT "wallet_balances_bucket_check"
      CHECK (
        ("account_type" = 'member' AND "agent_id" IS NULL
          AND "bucket" IN (
            'legacy_spendable', 'cashable_spendable', 'cashable_reserved',
            'purchased_spendable', 'gift_earnings_spendable', 'conversion_escrow'
          ))
        OR
        ("account_type" = 'site_owner' AND "user_id" IS NOT NULL AND "agent_id" IS NULL
          AND "bucket" IN ('site_inventory', 'site_profit'))
        OR
        ("account_type" = 'agent' AND "user_id" IS NULL AND "agent_id" IS NOT NULL
          AND "bucket" IN ('agent_inventory', 'agent_profit'))
        OR
        ("account_type" = 'system' AND "user_id" IS NULL AND "agent_id" IS NULL
          AND "bucket" IN ('platform_fee', 'external_clearing', 'legacy_opening_equity', 'site_inventory'))
      );
    ALTER TABLE "wallet_balances"
      DROP CONSTRAINT IF EXISTS "wallet_balances_site_owner_nonnegative_check";
    ALTER TABLE "wallet_balances"
      ADD CONSTRAINT "wallet_balances_site_owner_nonnegative_check"
      CHECK ("account_type" <> 'site_owner' OR "balance_coins" >= 0);
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_balances_site_owner_bucket_idx"
      ON "wallet_balances" ("user_id", "bucket")
      WHERE "account_type" = 'site_owner' AND "user_id" IS NOT NULL;

    ALTER TABLE "wallet_operations"
      DROP CONSTRAINT IF EXISTS "wallet_operations_actor_scope_check";
    ALTER TABLE "wallet_operations"
      ADD CONSTRAINT "wallet_operations_actor_scope_check"
      CHECK (
        ("actor_scope" = 'member' AND "actor_agent_id" IS NULL)
        OR
        ("actor_scope" = 'site_owner' AND "actor_user_id" IS NOT NULL AND "actor_agent_id" IS NULL)
        OR
        ("actor_scope" = 'agent' AND "actor_user_id" IS NULL AND "actor_agent_id" IS NOT NULL)
        OR
        ("actor_scope" = 'system' AND "actor_user_id" IS NULL AND "actor_agent_id" IS NULL)
      );
    CREATE UNIQUE INDEX IF NOT EXISTS "wallet_operations_site_owner_idempotency_idx"
      ON "wallet_operations" ("actor_user_id", "idempotency_key")
      WHERE "actor_scope" = 'site_owner' AND "actor_user_id" IS NOT NULL;
  `);
}

export async function ensureCashLedgerSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "cash_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "owner_type" varchar(24) NOT NULL,
      "owner_user_id" varchar(255) REFERENCES "users"("id") ON DELETE RESTRICT,
      "owner_agent_id" uuid REFERENCES "wallet_agents"("id") ON DELETE RESTRICT,
      "owner_reference" varchar(255),
      "bucket" varchar(40) NOT NULL,
      "currency_code" varchar(3) NOT NULL,
      "balance_minor_units" bigint DEFAULT 0 NOT NULL,
      "updated_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "cash_accounts_owner_check"
        CHECK (
          ("owner_type" = 'member' AND "owner_user_id" IS NOT NULL AND "owner_agent_id" IS NULL
            AND "owner_reference" IS NULL
            AND "bucket" IN ('recipient_earnings', 'withdrawable_balance', 'payout_reserved'))
          OR
          ("owner_type" = 'site_owner' AND "owner_user_id" IS NOT NULL AND "owner_agent_id" IS NULL
            AND "owner_reference" IS NULL AND "bucket" IN ('site_profit', 'payout_reserved'))
          OR
          ("owner_type" = 'hosting_owner' AND "owner_user_id" IS NULL AND "owner_agent_id" IS NULL
            AND "owner_reference" IS NOT NULL AND "owner_reference" = lower("owner_reference")
            AND "bucket" IN ('hosting_profit', 'payout_reserved'))
          OR
          ("owner_type" = 'agent' AND "owner_user_id" IS NULL AND "owner_agent_id" IS NOT NULL
            AND "owner_reference" IS NULL AND "bucket" IN ('sales_reward', 'payout_reserved'))
          OR
          ("owner_type" = 'system' AND "owner_user_id" IS NULL AND "owner_agent_id" IS NULL
            AND "owner_reference" IS NULL
            AND "bucket" IN ('settlement_clearing', 'opening_equity', 'platform_cash_asset'))
        ),
      CONSTRAINT "cash_accounts_currency_check" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
      CONSTRAINT "cash_accounts_nonnegative_check"
        CHECK (
          ("owner_type" = 'system' AND "bucket" IN ('settlement_clearing', 'opening_equity'))
          OR "balance_minor_units" >= 0
        )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_id_currency_idx"
      ON "cash_accounts" ("id", "currency_code");
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_member_bucket_currency_idx"
      ON "cash_accounts" ("owner_user_id", "bucket", "currency_code")
      WHERE "owner_type" = 'member';
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_site_owner_bucket_currency_idx"
      ON "cash_accounts" ("owner_user_id", "bucket", "currency_code")
      WHERE "owner_type" = 'site_owner';
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_hosting_owner_bucket_currency_idx"
      ON "cash_accounts" ("owner_reference", "bucket", "currency_code")
      WHERE "owner_type" = 'hosting_owner';
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_agent_bucket_currency_idx"
      ON "cash_accounts" ("owner_agent_id", "bucket", "currency_code")
      WHERE "owner_type" = 'agent';
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_system_bucket_currency_idx"
      ON "cash_accounts" ("bucket", "currency_code")
      WHERE "owner_type" = 'system';

    CREATE TABLE IF NOT EXISTS "cash_operations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_scope" varchar(16) NOT NULL,
      "actor_user_id" varchar(255) REFERENCES "users"("id") ON DELETE RESTRICT,
      "actor_agent_id" uuid REFERENCES "wallet_agents"("id") ON DELETE RESTRICT,
      "operation_type" varchar(40) NOT NULL,
      "idempotency_key" varchar(128) NOT NULL,
      "request_fingerprint" varchar(64) NOT NULL,
      "currency_code" varchar(3) NOT NULL,
      "reference_type" varchar(40),
      "reference_id" varchar(255),
      "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "cash_operations_actor_scope_check"
        CHECK (
          ("actor_scope" IN ('member', 'site_owner') AND "actor_user_id" IS NOT NULL AND "actor_agent_id" IS NULL)
          OR
          ("actor_scope" = 'agent' AND "actor_user_id" IS NULL AND "actor_agent_id" IS NOT NULL)
          OR
          ("actor_scope" = 'system' AND "actor_user_id" IS NULL AND "actor_agent_id" IS NULL)
        ),
      CONSTRAINT "cash_operations_currency_check" CHECK ("currency_code" ~ '^[A-Z]{3}$'),
      CONSTRAINT "cash_operations_fingerprint_check"
        CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "cash_operations_idempotency_key_check"
        CHECK (length(trim("idempotency_key")) > 0)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_operations_id_currency_idx"
      ON "cash_operations" ("id", "currency_code");
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_operations_member_idempotency_idx"
      ON "cash_operations" ("actor_user_id", "idempotency_key")
      WHERE "actor_scope" = 'member' AND "actor_user_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_operations_site_owner_idempotency_idx"
      ON "cash_operations" ("actor_user_id", "idempotency_key")
      WHERE "actor_scope" = 'site_owner' AND "actor_user_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_operations_agent_idempotency_idx"
      ON "cash_operations" ("actor_agent_id", "idempotency_key")
      WHERE "actor_scope" = 'agent' AND "actor_agent_id" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_operations_system_idempotency_idx"
      ON "cash_operations" ("idempotency_key")
      WHERE "actor_scope" = 'system';
    CREATE INDEX IF NOT EXISTS "cash_operations_reference_idx"
      ON "cash_operations" ("reference_type", "reference_id");
    CREATE INDEX IF NOT EXISTS "cash_operations_created_idx"
      ON "cash_operations" ("created_at");

    CREATE TABLE IF NOT EXISTS "cash_entries" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "operation_id" uuid NOT NULL,
      "cash_account_id" uuid NOT NULL,
      "currency_code" varchar(3) NOT NULL,
      "amount_minor_units" bigint NOT NULL,
      "reversal_of_entry_id" uuid REFERENCES "cash_entries"("id") ON DELETE RESTRICT,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "cash_entries_operation_currency_fk"
        FOREIGN KEY ("operation_id", "currency_code")
        REFERENCES "cash_operations"("id", "currency_code") ON DELETE RESTRICT,
      CONSTRAINT "cash_entries_account_currency_fk"
        FOREIGN KEY ("cash_account_id", "currency_code")
        REFERENCES "cash_accounts"("id", "currency_code") ON DELETE RESTRICT,
      CONSTRAINT "cash_entries_nonzero_amount_check" CHECK ("amount_minor_units" <> 0),
      CONSTRAINT "cash_entries_currency_check" CHECK ("currency_code" ~ '^[A-Z]{3}$')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_entries_operation_account_idx"
      ON "cash_entries" ("operation_id", "cash_account_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "cash_entries_reversal_once_idx"
      ON "cash_entries" ("reversal_of_entry_id")
      WHERE "reversal_of_entry_id" IS NOT NULL;
    CREATE INDEX IF NOT EXISTS "cash_entries_operation_idx" ON "cash_entries" ("operation_id");
    CREATE INDEX IF NOT EXISTS "cash_entries_account_idx" ON "cash_entries" ("cash_account_id");
  `);

  await client.query(`
    ALTER TABLE "cash_accounts"
      DROP CONSTRAINT IF EXISTS "cash_accounts_owner_check";
    ALTER TABLE "cash_accounts"
      ADD CONSTRAINT "cash_accounts_owner_check"
      CHECK (
        ("owner_type" = 'member' AND "owner_user_id" IS NOT NULL AND "owner_agent_id" IS NULL
          AND "owner_reference" IS NULL
          AND "bucket" IN ('recipient_earnings', 'withdrawable_balance', 'payout_reserved'))
        OR
        ("owner_type" = 'site_owner' AND "owner_user_id" IS NOT NULL AND "owner_agent_id" IS NULL
          AND "owner_reference" IS NULL AND "bucket" IN ('site_profit', 'payout_reserved'))
        OR
        ("owner_type" = 'hosting_owner' AND "owner_user_id" IS NULL AND "owner_agent_id" IS NULL
          AND "owner_reference" IS NOT NULL AND "owner_reference" = lower("owner_reference")
          AND "bucket" IN ('hosting_profit', 'payout_reserved'))
        OR
        ("owner_type" = 'agent' AND "owner_user_id" IS NULL AND "owner_agent_id" IS NOT NULL
          AND "owner_reference" IS NULL AND "bucket" IN ('sales_reward', 'payout_reserved'))
        OR
        ("owner_type" = 'system' AND "owner_user_id" IS NULL AND "owner_agent_id" IS NULL
          AND "owner_reference" IS NULL
          AND "bucket" IN ('settlement_clearing', 'opening_equity', 'platform_cash_asset'))
      );
  `);

  await client.query(`
    CREATE OR REPLACE FUNCTION "prevent_cash_record_mutation"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'cash financial records are append-only'
        USING ERRCODE = '55000';
    END;
    $$;

    CREATE OR REPLACE FUNCTION "prevent_cash_account_reassignment"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'DELETE'
        OR (to_jsonb(NEW) - 'balance_minor_units' - 'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD) - 'balance_minor_units' - 'updated_at') THEN
        RAISE EXCEPTION 'cash account ownership and currency are immutable'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cash_operations_immutable'
        AND tgrelid = 'public.cash_operations'::regclass) THEN
        CREATE TRIGGER "cash_operations_immutable"
          BEFORE UPDATE OR DELETE ON "cash_operations"
          FOR EACH ROW EXECUTE FUNCTION "prevent_cash_record_mutation"();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cash_operations_no_truncate'
        AND tgrelid = 'public.cash_operations'::regclass) THEN
        CREATE TRIGGER "cash_operations_no_truncate"
          BEFORE TRUNCATE ON "cash_operations"
          FOR EACH STATEMENT EXECUTE FUNCTION "prevent_cash_record_mutation"();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cash_entries_immutable'
        AND tgrelid = 'public.cash_entries'::regclass) THEN
        CREATE TRIGGER "cash_entries_immutable"
          BEFORE UPDATE OR DELETE ON "cash_entries"
          FOR EACH ROW EXECUTE FUNCTION "prevent_cash_record_mutation"();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cash_entries_no_truncate'
        AND tgrelid = 'public.cash_entries'::regclass) THEN
        CREATE TRIGGER "cash_entries_no_truncate"
          BEFORE TRUNCATE ON "cash_entries"
          FOR EACH STATEMENT EXECUTE FUNCTION "prevent_cash_record_mutation"();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cash_accounts_identity_immutable'
        AND tgrelid = 'public.cash_accounts'::regclass) THEN
        CREATE TRIGGER "cash_accounts_identity_immutable"
          BEFORE UPDATE OR DELETE ON "cash_accounts"
          FOR EACH ROW EXECUTE FUNCTION "prevent_cash_account_reassignment"();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cash_accounts_no_truncate'
        AND tgrelid = 'public.cash_accounts'::regclass) THEN
        CREATE TRIGGER "cash_accounts_no_truncate"
          BEFORE TRUNCATE ON "cash_accounts"
          FOR EACH STATEMENT EXECUTE FUNCTION "prevent_cash_record_mutation"();
      END IF;
    END;
    $$;
  `);
}

export async function ensureDefaultMemberRole() {
  const client = await dbPool.connect();
  try {
    await applyDefaultMemberRoleMigration(client);
  } finally {
    client.release();
  }
}

export async function ensureAdminGiftTabPermission() {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('hobi.site_owner_bootstrap', 'on', true)`);
    await client.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source")
       SELECT DISTINCT "role_id", 'admin_gifts.read', 'true'::jsonb, 'admin_tab_split'
       FROM "role_permissions"
       WHERE "permission_key" IN ('admin_giftsgit.read', 'admin_giftsgit.all')
         AND "permission_value" = 'true'::jsonb
       ON CONFLICT ("role_id", "permission_key") DO NOTHING`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureFinancialFoundationSchema(client: PoolClient) {
  await ensureFinancialWalletAccountsSchema(client);
  await ensureCashLedgerSchema(client);
}

export async function ensureSiteOwnerRoleProtectionSchema(client: PoolClient) {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('hobi-site-owner-protection-schema'))`);
    await client.query(`
    CREATE OR REPLACE FUNCTION "prevent_site_owner_role_mutation"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF current_setting('hobi.site_owner_bootstrap', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END IF;

      IF TG_TABLE_NAME = 'roles' THEN
        IF TG_OP = 'INSERT' THEN
          IF NEW."name" = '${SITE_OWNER_ROLE_NAME}' THEN
            RAISE EXCEPTION 'site owner role is protected' USING ERRCODE = '42501';
          END IF;
        ELSIF TG_OP = 'UPDATE' THEN
          IF OLD."name" = '${SITE_OWNER_ROLE_NAME}' OR NEW."name" = '${SITE_OWNER_ROLE_NAME}' THEN
            RAISE EXCEPTION 'site owner role is protected' USING ERRCODE = '42501';
          END IF;
        ELSIF OLD."name" = '${SITE_OWNER_ROLE_NAME}' THEN
          RAISE EXCEPTION 'site owner role is protected' USING ERRCODE = '42501';
        END IF;
      ELSIF TG_TABLE_NAME = 'role_permissions' THEN
        IF TG_OP = 'INSERT' THEN
          IF EXISTS (SELECT 1 FROM "roles" WHERE "id" = NEW."role_id" AND "name" = '${SITE_OWNER_ROLE_NAME}') THEN
            RAISE EXCEPTION 'site owner permissions are protected' USING ERRCODE = '42501';
          END IF;
        ELSIF TG_OP = 'DELETE' THEN
          IF EXISTS (SELECT 1 FROM "roles" WHERE "id" = OLD."role_id" AND "name" = '${SITE_OWNER_ROLE_NAME}') THEN
            RAISE EXCEPTION 'site owner permissions are protected' USING ERRCODE = '42501';
          END IF;
        ELSE
          IF EXISTS (SELECT 1 FROM "roles" WHERE "id" IN (OLD."role_id", NEW."role_id") AND "name" = '${SITE_OWNER_ROLE_NAME}') THEN
            RAISE EXCEPTION 'site owner permissions are protected' USING ERRCODE = '42501';
          END IF;
        END IF;
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;
    `);
    await client.query(`DROP TRIGGER IF EXISTS "site_owner_role_guard" ON "roles"`);
    await client.query(`
      CREATE TRIGGER "site_owner_role_guard"
      BEFORE INSERT OR UPDATE OR DELETE ON "roles"
      FOR EACH ROW EXECUTE FUNCTION "prevent_site_owner_role_mutation"()
    `);
    await client.query(`DROP TRIGGER IF EXISTS "site_owner_permissions_guard" ON "role_permissions"`);
    await client.query(`
      CREATE TRIGGER "site_owner_permissions_guard"
      BEFORE INSERT OR UPDATE OR DELETE ON "role_permissions"
      FOR EACH ROW EXECUTE FUNCTION "prevent_site_owner_role_mutation"()
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function ensureSiteOwnerAccount(
  config: SiteOwnerBootstrapConfig,
) {
  const permissionKeys = getSiteOwnerPermissionKeys(RESOURCE_ACTIONS);
  return ensureSiteOwnerBootstrap(config, permissionKeys);
}

export async function ensureSystemOwnerRole() {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('hobi.site_owner_bootstrap', 'on', true)`);
    await client.query(`ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "is_owner" boolean DEFAULT false NOT NULL;`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('hobi-system-owner-role'));`);

    const existingOwner = await client.query(
      `SELECT "id"
       FROM "roles"
       WHERE "name" <> $2
          AND (
            "is_owner" = true
            OR (
              "is_default" = false
              AND (
                lower(trim("name")) IN ($1, 'owner', 'ispower', 'مالك')
                OR lower(trim(COALESCE("legacy_name", ''))) IN ('owner', 'ispower', 'مالك')
              )
            )
          )
       ORDER BY ("name" = $1) DESC, "is_owner" DESC, "rank" DESC
       LIMIT 1
       FOR UPDATE`,
      [SYSTEM_OWNER_ROLE_NAME, SITE_OWNER_ROLE_NAME],
    );

    let ownerRoleId: string;
    if (existingOwner.rows[0]) {
      ownerRoleId = String(existingOwner.rows[0].id);
      await client.query(
        `UPDATE "roles"
         SET "legacy_name" = 'Owner',
             "name" = $1,
             "rank" = $2,
             "is_system" = true,
             "is_default" = false,
             "is_owner" = true,
             "is_active" = true,
             "auto_enabled" = false,
             "auto_promote" = false,
             "auto_points" = 0,
             "updated_at" = now()
         WHERE "id" = $3`,
        [SYSTEM_OWNER_ROLE_NAME, SYSTEM_OWNER_RANK, ownerRoleId],
      );
    } else {
      const createdOwner = await client.query(
        `INSERT INTO "roles"
          ("legacy_name", "name", "rank", "is_system", "is_owner", "is_active")
         VALUES ('Owner', $1, $2, true, true, true)
         ON CONFLICT ("name") DO UPDATE
           SET "legacy_name" = 'Owner',
               "rank" = EXCLUDED."rank",
               "is_system" = true,
               "is_owner" = true,
               "is_active" = true
         RETURNING "id"`,
        [SYSTEM_OWNER_ROLE_NAME, SYSTEM_OWNER_RANK],
      );
      ownerRoleId = String(createdOwner.rows[0].id);
    }

    await client.query(
      `UPDATE "roles"
       SET "is_owner" = false
       WHERE "is_owner" = true AND "id" <> $1`,
      [ownerRoleId],
    );
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "roles_single_owner_idx"
       ON "roles" ("is_owner") WHERE "is_owner" = true`,
    );

    const legacyOwnerRoles = await client.query(
      `SELECT "id"
       FROM "roles"
       WHERE "id" <> $1
         AND "name" <> $2
         AND (
           lower(trim("name")) IN ('owner', 'ispower', 'مالك')
           OR lower(trim(COALESCE("legacy_name", ''))) IN ('owner', 'ispower', 'مالك')
         )`,
      [ownerRoleId, SITE_OWNER_ROLE_NAME],
    );
    for (const legacyRole of legacyOwnerRoles.rows) {
      await client.query(
        `INSERT INTO "user_role_assignments"
          ("user_id", "role_id", "starts_at", "expires_at", "legacy_metadata")
         SELECT ura."user_id", $1, ura."starts_at", NULL,
                jsonb_build_object('source', 'system_owner_role_migration')
         FROM "user_role_assignments" ura
         JOIN "users" u ON u."id"::text = ura."user_id"
         WHERE ura."role_id" = $2 AND lower(trim(u."username")) = $3
         ON CONFLICT ("user_id", "role_id") DO NOTHING`,
        [ownerRoleId, legacyRole.id, SYSTEM_OWNER_USERNAME],
      );
      await client.query(`DELETE FROM "user_role_assignments" WHERE "role_id" = $1`, [legacyRole.id]);
      await client.query(
        `UPDATE "roles"
         SET "name" = 'legacy_owner_' || left("id"::text, 12),
             "legacy_name" = 'Owner (legacy)',
             "is_active" = false,
             "is_system" = true,
             "is_default" = false,
             "rank" = LEAST("rank", $1),
             "updated_at" = now()
         WHERE "id" = $2`,
        [SYSTEM_OWNER_RANK - 1, legacyRole.id],
      );
    }

    await client.query(
      `UPDATE "users"
       SET "power" = 'owner', "role" = 'owner'
       WHERE lower(trim("username")) = $1`,
      [SYSTEM_OWNER_USERNAME],
    );
    await client.query(
      `INSERT INTO "user_role_assignments" ("user_id", "role_id", "legacy_metadata")
       SELECT "id"::text, $1, jsonb_build_object('source', 'system_owner_bootstrap')
       FROM "users"
       WHERE lower(trim("username")) = $2
       ON CONFLICT ("user_id", "role_id") DO NOTHING`,
      [ownerRoleId, SYSTEM_OWNER_USERNAME],
    );
    await client.query(
      `DELETE FROM "user_role_assignments" ura
       USING "users" u
       WHERE ura."user_id" = u."id"::text
         AND ura."role_id" = $1
         AND lower(trim(u."username")) <> $2`,
      [ownerRoleId, SYSTEM_OWNER_USERNAME],
    );

    for (const [resource, actions] of Object.entries(RESOURCE_ACTIONS)) {
      for (const action of actions) {
        await client.query(
          `INSERT INTO "role_permissions"
            ("role_id", "permission_key", "permission_value", "source")
           VALUES ($1, $2, 'true'::jsonb, 'system_owner')
           ON CONFLICT ("role_id", "permission_key")
           DO UPDATE SET "permission_value" = 'true'::jsonb, "source" = 'system_owner'`,
          [ownerRoleId, `${resource}.${action}`],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureChatFeaturePermissions() {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('hobi.site_owner_bootstrap', 'on', true)`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('hobi-chat-feature-permissions'));`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "permission_migrations" (
        "migration_key" varchar(120) PRIMARY KEY,
        "applied_at" timestamptz DEFAULT now() NOT NULL
      );
    `);
    const migration = await client.query(
      `INSERT INTO "permission_migrations" ("migration_key")
       VALUES ('chat_feature_permissions_v1')
       ON CONFLICT ("migration_key") DO NOTHING
       RETURNING "migration_key"`,
    );
    if (migration.rowCount) {
      await client.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_key", "permission_value", "source")
         SELECT r."id", feature."permission_key", 'true'::jsonb, 'chat_features_migration'
         FROM "roles" r
         CROSS JOIN unnest($1::text[]) AS feature("permission_key")
         WHERE r."is_active" = true AND r."is_owner" = false
         ON CONFLICT ("role_id", "permission_key") DO NOTHING`,
        [DEFAULT_CHAT_FEATURE_PERMISSION_KEYS],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Auto-migration: يُنشئ الجداول الناقصة تلقائياً عند تشغيل السيرفر.
 * آمن للتشغيل المتكرر (يستخدم IF NOT EXISTS).
 */
export async function runAutoMigrations() {
  const client = await dbPool.connect();
  try {
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] بدء فحص الجداول الناقصة...");
    }

    // 1. إنشاء أنواع الـ Enum أولاً إذا لم تكن موجودة
    const enumQueries = [
      `DO $$ BEGIN CREATE TYPE "account_role" AS ENUM ('guest','member','moderator','owner','admin','agent'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN CREATE TYPE "account_status" AS ENUM ('active','muted','banned','suspended','deleted'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN CREATE TYPE "edge_type" AS ENUM ('friend','follow','block','mute','mutual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      `DO $$ BEGIN CREATE TYPE "presence_status" AS ENUM ('online','idle','lurking','active','multitasking'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    ];
    for (const q of enumQueries) {
      await client.query(q).catch(() => { /* الـ enum موجود مسبقاً */ });
    }

    // 2. تفعيل إضافة pgcrypto لتوفير gen_random_uuid()
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // 3. التحقق وإضافة الأعمدة الناقصة في جدول users (لأن الجدول موجود مسبقاً وقد تنقصه أعمدة جديدة)
    await client.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "legacy_id" integer;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" varchar(120);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "account_role" DEFAULT 'member';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" "account_status" DEFAULT 'active';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cover_url" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country_code" varchar(16);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "presence" "presence_status" DEFAULT 'online';
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamptz DEFAULT now();
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now();
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();
    `);

    // 4. تعبئة قيم id الفارغة أو الـ NULL بـ UUID عشوائي
    await client.query(`
      UPDATE "users"
      SET "id" = gen_random_uuid()
      WHERE "id" IS NULL OR "id"::text = '';
    `);

    // Ensure idreg exists before duplicate-id cleanup below references it.
    await client.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "idreg" integer;`);

    // 5. حل مشكلة قيم id المكررة (توليد UUID جديد للمكررات فقط والإبقاء على نسخة واحدة)
    await client.query(`
      UPDATE "users" u
      SET "id" = gen_random_uuid()
      FROM (
        SELECT idreg, ROW_NUMBER() OVER (PARTITION BY id ORDER BY idreg) as rn
        FROM "users"
        WHERE id IS NOT NULL
      ) dup
      WHERE u.idreg = dup.idreg AND dup.rn > 1;
    `);

    // 6. إضافة الأعمدة القديمة المتوقعة من الكود (uid, topic, pic, idreg, power, ...)
    await client.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "uid" varchar(255);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "idreg" integer;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "topic" varchar(255);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pic" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pich" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "power" varchar(80);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "msg" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password" varchar(255);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ucol" varchar(20);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mcol" varchar(20);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "them" varchar(80);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cover" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ico" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gift_ico" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bg" varchar(20);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gcol" varchar(20);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastssen" bigint;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joinuser" bigint;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "coins" integer DEFAULT 0;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rep" integer DEFAULT 0;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "evaluation" integer DEFAULT 0;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "site_badge" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "site_badge_id" varchar(80);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wall_post_likes" integer DEFAULT 0;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gifts_received_count" integer DEFAULT 0;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lid" varchar(40);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ip" varchar(45);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fp" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "device_signature" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentationc" boolean DEFAULT false;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "muted" integer DEFAULT 0;
    `);

    // تعبئة uid من id للمستخدمين الجدد
    await client.query(`
      UPDATE "users" SET "uid" = "id", "topic" = "display_name" WHERE "uid" IS NULL AND "id" IS NOT NULL;
    `);

      // 6c. Ensure legacy numeric idreg column has a sequence default so new users get an idreg
      // Create a sequence if it doesn't exist and set users.idreg default to nextval of that sequence.
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'users_idreg_seq') THEN
            CREATE SEQUENCE users_idreg_seq START 1000;
          END IF;
          -- Ensure the idreg column has a default pointing to the sequence
          ALTER TABLE "users" ALTER COLUMN "idreg" SET DEFAULT nextval('users_idreg_seq');
        END $$;
      `);

      // Backfill existing rows where idreg is NULL or 0 with values from the sequence
      await client.query(`
        WITH missing AS (
          SELECT id FROM users WHERE COALESCE(idreg, 0) = 0 OR idreg IS NULL
          FOR UPDATE
        )
        UPDATE users u
        SET idreg = nextval('users_idreg_seq')
        FROM missing m
        WHERE u.id = m.id;
      `);

    // 6ب. إضافة الأعمدة القديمة المتوقعة لجدول الغرف (rooms)
    await client.query(`
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "idroom" SERIAL;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "topic" varchar(255);
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "about" text;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "owner" varchar(255);
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "pic" text;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "mic" integer DEFAULT 0;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "needpass" integer DEFAULT 0;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "deleted" integer DEFAULT 0;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT false;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "room_layout" varchar(50) DEFAULT 'normal';
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "user" varchar(255);
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "pass" varchar(255) DEFAULT '';
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "rmli" integer DEFAULT 0;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "welcome" varchar(255) DEFAULT '';
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "broadcast" smallint DEFAULT 0;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "color" varchar(255) DEFAULT '#000000';
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "max" integer DEFAULT 50;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "stage_count" integer DEFAULT 5;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "stage_state" text;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "room_owner_meta" text;
      ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "message_mode" varchar(16) DEFAULT 'real';
    `);

    // 7. التأكد من وجود قيد فريد على حقل id في جدول users لتمكين الجداول الأخرى من الإشارة إليه كمفتاح خارجي
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1 FROM information_schema.table_constraints 
              WHERE table_name='users' AND constraint_name='users_id_unique'
          ) THEN
              ALTER TABLE "users" ADD CONSTRAINT "users_id_unique" UNIQUE ("id");
          END IF;
      END $$;
    `).catch((e: any) => console.warn("[Migration] ⚠️ تحذير: فشل إضافة unique constraint (قد يكون موجوداً مسبقاً):", e.message));

    // --- 0. جدول moderation_bans (الحظر) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "moderation_bans" (
        "id" SERIAL PRIMARY KEY,
        "target_name" varchar(255),
        "ban_type" varchar(50) NOT NULL,
        "decoder_code" text,
        "ip_address" varchar(45),
        "device_fingerprint" text,
        "device_signature" text,
        "country_code" varchar(10),
        "expires_at" timestamptz,
        "expires_label" varchar(50) DEFAULT 'دائم',
        "is_active" boolean DEFAULT true,
        "created_by" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamptz DEFAULT now()
      );
    `);
    await client.query(`ALTER TABLE "moderation_bans" ADD COLUMN IF NOT EXISTS "device_signature" text;`);
    await client.query(`ALTER TABLE "moderation_bans" ADD COLUMN IF NOT EXISTS "reason" text;`);

    // --- 1. جدول user_profiles ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user_profiles" (
        "user_id" varchar(255) PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "idreg" varchar(40),
        "lid" varchar(40),
        "uid" varchar(40),
        "profile_msg" text,
        "bio" text,
        "mood" varchar(120),
        "custom_status" text,
        "stealth" boolean DEFAULT false,
        "youtube_url" text,
        "autoplay_enabled" boolean DEFAULT false,
        "avatar_url" text,
        "banner_url" text,
        "theme_id" varchar(80),
        "avatar_frame_url" text,
        "gift_icon_url" text,
        "profile_icon_url" text,
        "name_gradient" text,
        "name_effect_id" varchar(80),
        "message_bubble_style" varchar(80),
        "profile_accent_color" varchar(20),
        "profile_background_url" text,
        "background_color" varchar(20),
        "message_color" varchar(20),
        "name_color" varchar(20),
        "gradient_color" varchar(20),
        "evaluation" integer DEFAULT 0,
        "rep" integer DEFAULT 0,
        "coins" integer DEFAULT 0,
        "wall_post_likes" integer DEFAULT 0,
        "gifts_received_count" integer DEFAULT 0,
        "power" varchar(80),
        "icon" text,
        "is_login" varchar(20),
        "muted" boolean DEFAULT false,
        "documents" boolean DEFAULT false,
        "busy" boolean DEFAULT false,
        "alerts" boolean DEFAULT true,
        "nopmcall" boolean DEFAULT false,
        "nopmvideocall" boolean DEFAULT false,
        "room_id" varchar(128),
        "site_badge_id" varchar(80),
        "site_badge" text,
        "joinuser" bigint,
        "updated_at" timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "profile_msg" text;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "avatar_url" text;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "banner_url" text;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "site_badge" text;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "site_badge_id" varchar(80);
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "power" varchar(80);
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "wall_post_likes" integer DEFAULT 0;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "gifts_received_count" integer DEFAULT 0;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "rep" integer DEFAULT 0;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "coins" integer DEFAULT 0;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "evaluation" integer DEFAULT 0;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "muted" boolean DEFAULT false;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "documents" boolean DEFAULT false;
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "room_id" varchar(128);
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();
      ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "member_card_bg_url" text;
    `);

    // إنشاء سجل بروفايل فارغ لكل مستخدم ليس لديه بروفايل بعد
    await client.query(`
      INSERT INTO "user_profiles" ("user_id")
      SELECT "id" FROM "users" u
      WHERE NOT EXISTS (
        SELECT 1 FROM "user_profiles" p WHERE p."user_id" = u."id"
      );
    `);

    await client.query(`
      UPDATE "user_profiles" p
      SET
        "profile_msg" = COALESCE(NULLIF(p."profile_msg", ''), u."msg"),
        "avatar_url" = COALESCE(NULLIF(p."avatar_url", ''), u."pic"),
        "banner_url" = COALESCE(NULLIF(p."banner_url", ''), u."pich"),
        "site_badge" = COALESCE(NULLIF(p."site_badge", ''), u."site_badge"),
        "site_badge_id" = COALESCE(NULLIF(p."site_badge_id", ''), u."site_badge_id"),
        "power" = COALESCE(NULLIF(p."power", ''), u."power"),
        "wall_post_likes" = COALESCE(p."wall_post_likes", 0),
        "gifts_received_count" = COALESCE(p."gifts_received_count", 0),
        "rep" = COALESCE(p."rep", 0),
        "coins" = COALESCE(p."coins", 0),
        "evaluation" = COALESCE(p."evaluation", 0),
        "muted" = COALESCE(p."muted", false) OR COALESCE(u."muted", 0) = 1,
        "documents" = COALESCE(p."documents", false) OR COALESCE(u."documentationc", false)
      FROM "users" u
      WHERE p."user_id" = u."id"
        AND (
          p."profile_msg" IS NULL
          OR p."profile_msg" = ''
          OR p."avatar_url" IS NULL
          OR p."banner_url" IS NULL
          OR p."site_badge" IS NULL
          OR p."site_badge_id" IS NULL
        );
    `);

    // --- 2. جدول profile_visits ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "profile_visits" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "visitor_id" varchar(255) REFERENCES "users"("id") ON DELETE CASCADE,
        "profile_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "visited_at" timestamptz DEFAULT now() NOT NULL,
        "hidden_visit" boolean DEFAULT false NOT NULL,
        "source" varchar(80)
      );
      CREATE INDEX IF NOT EXISTS "profile_visits_profile_idx" ON "profile_visits" ("profile_id");
      CREATE INDEX IF NOT EXISTS "profile_visits_visitor_idx" ON "profile_visits" ("visitor_id");
    `);
    await client.query(`ALTER TABLE "profile_visits" ADD COLUMN IF NOT EXISTS "source" varchar(80);`);

    // --- 3. جدول user_verifications ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user_verifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type" varchar(40) NOT NULL,
        "status" varchar(40) DEFAULT 'pending' NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "verified_at" timestamptz,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "user_verifications_user_idx" ON "user_verifications" ("user_id");
    `);

    // --- 4. الجداول الأخرى من schema.ts ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "social_edges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "target_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type" varchar(20) NOT NULL,
        "weight" integer DEFAULT 1 NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "social_edges_pair_idx" ON "social_edges" ("source_id", "target_id", "type");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "social_affinity" (
        "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "related_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "score" numeric(10,2) DEFAULT 0 NOT NULL,
        "interaction_count" integer DEFAULT 0 NOT NULL,
        "last_interaction_at" timestamptz,
        PRIMARY KEY ("user_id", "related_id")
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "identity_effects" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "slug" varchar(64) NOT NULL,
        "name" varchar(120) NOT NULL,
        "type" varchar(40) NOT NULL,
        "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "asset_url" text,
        "is_premium" boolean DEFAULT false NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "identity_effects_slug_idx" ON "identity_effects" ("slug");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "user_identity_state" (
        "user_id" varchar(255) PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "active_frame_id" uuid REFERENCES "identity_effects"("id"),
        "active_aura_id" uuid REFERENCES "identity_effects"("id"),
        "active_theme_id" varchar(80),
        "custom_css" text,
        "reactive_config" jsonb DEFAULT '{}'::jsonb NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "behavior_scores" (
        "user_id" varchar(255) PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "trust_score" integer DEFAULT 50 NOT NULL,
        "toxicity_score" integer DEFAULT 0 NOT NULL,
        "influence_score" integer DEFAULT 0 NOT NULL,
        "spam_probability" numeric(4,3) DEFAULT 0 NOT NULL,
        "last_recalculated_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "activity_stream" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "verb" varchar(64) NOT NULL,
        "object_type" varchar(64) NOT NULL,
        "object_id" varchar(128),
        "target_id" varchar(128),
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "visibility" varchar(32) DEFAULT 'public' NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "activity_stream_actor_idx" ON "activity_stream" ("actor_id");
      CREATE INDEX IF NOT EXISTS "activity_stream_verb_idx" ON "activity_stream" ("verb");
      CREATE INDEX IF NOT EXISTS "activity_stream_created_idx" ON "activity_stream" ("created_at");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "moderation_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "target_user_id" varchar(255) REFERENCES "users"("id") ON DELETE CASCADE,
        "room_id" uuid,
        "event_type" varchar(64) NOT NULL,
        "reason" text,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "site_settings" (
        "key" varchar(120) PRIMARY KEY,
        "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "updated_by" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "voice_provider_accounts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "url" text NOT NULL,
        "api_key_encrypted" jsonb NOT NULL,
        "api_secret_encrypted" jsonb NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "voice_provider_selection" (
        "id" integer PRIMARY KEY DEFAULT 1,
        "provider" varchar(16) DEFAULT 'webrtc' NOT NULL,
        "livekit_account_id" uuid
          REFERENCES "voice_provider_accounts"("id") ON DELETE RESTRICT,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "voice_provider_selection_singleton_check" CHECK ("id" = 1),
        CONSTRAINT "voice_provider_selection_provider_check"
          CHECK ("provider" IN ('webrtc', 'livekit')),
        CONSTRAINT "voice_provider_selection_account_check"
          CHECK (
            ("provider" = 'webrtc' AND "livekit_account_id" IS NULL)
            OR ("provider" = 'livekit' AND "livekit_account_id" IS NOT NULL)
          )
      );
    `);

    await client.query(`
      INSERT INTO "voice_provider_selection" ("id", "provider", "livekit_account_id")
      VALUES (1, 'webrtc', NULL)
      ON CONFLICT ("id") DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "chat_bots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bot_key" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" text,
        "kind" varchar(60) NOT NULL,
        "avatar_url" text,
        "is_active" boolean DEFAULT true NOT NULL,
        "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "chat_bots_key_idx" ON "chat_bots" ("bot_key");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "moderation_filters" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "pattern" varchar(240) NOT NULL,
        "action" varchar(40) DEFAULT 'block' NOT NULL,
        "scope" varchar(40) DEFAULT 'global' NOT NULL,
        "severity" integer DEFAULT 1 NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "note" text,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "actor_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "action" varchar(120) NOT NULL,
        "target_type" varchar(64),
        "target_id" varchar(128),
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "wall_posts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "author_id" varchar(255) REFERENCES "users"("id") ON DELETE CASCADE,
        "body" text,
        "media_url" text,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "wall_comments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "post_id" uuid REFERENCES "wall_posts"("id") ON DELETE CASCADE,
        "author_id" varchar(255) REFERENCES "users"("id") ON DELETE CASCADE,
        "parent_id" uuid REFERENCES "wall_comments"("id") ON DELETE CASCADE,
        "body" text,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
    `);
    // إضافة parent_id إذا كان الجدول موجوداً مسبقاً بدونه
    try { await client.query(`ALTER TABLE "wall_comments" ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "wall_comments"("id") ON DELETE CASCADE`); } catch (_) {}
    await client.query(`CREATE INDEX IF NOT EXISTS "wall_comments_post_idx" ON "wall_comments" ("post_id")`);
    await client.query(`CREATE INDEX IF NOT EXISTS "wall_comments_parent_idx" ON "wall_comments" ("parent_id")`);

    // ----- إنشاء جداول الحائط القديمة (bars / bar_comments) إن لم توجد -----
    await client.query(`
      CREATE TABLE IF NOT EXISTS "bars" (
        "id" SERIAL PRIMARY KEY,
        "uid" varchar(255),
        "msg" text,
        "pic" text,
        "media_urls" text,
        "topic" varchar(255)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "bar_comments" (
        "id" SERIAL PRIMARY KEY,
        "bar_id" integer REFERENCES "bars"("id") ON DELETE CASCADE,
        "author_id" varchar(255),
        "author_topic" varchar(255),
        "author_pic" text,
        "body" text,
        "parent_id" integer REFERENCES "bar_comments"("id") ON DELETE CASCADE
      );
    `);

    // إضافة أعمدة parent_id و author_id إلى جدول bar_comments إن لم توجد
    try { await client.query(`ALTER TABLE "bar_comments" ADD COLUMN IF NOT EXISTS "parent_id" integer`); } catch (_) {}
    try { await client.query(`ALTER TABLE "bar_comments" ADD COLUMN IF NOT EXISTS "author_id" varchar(255)`); } catch (_) {}

    // إضافة عمود media_urls لتخزين عدة صور/فيديو في المنشورات
    try { await client.query(`ALTER TABLE "bars" ADD COLUMN IF NOT EXISTS "media_urls" text`); } catch (_) {}
    // إضافة عمود animated_faces لتخزين روابط الفيسات المتحركة
    try { await client.query(`ALTER TABLE "bars" ADD COLUMN IF NOT EXISTS "animated_faces" text`); } catch (_) {}
    // تعبئة author_id من جدول users (حيثما أمكن)
    try {
      await client.query(`
        UPDATE "bar_comments" bc
        SET "author_id" = u.id
        FROM "users" u
        WHERE bc.author_id IS NULL
          AND (u.username = bc.author_topic OR u.topic = bc.author_topic)
      `);
    } catch (_) {}

    await client.query(`
      CREATE TABLE IF NOT EXISTS "wall_post_likes" (
        "post_id" uuid REFERENCES "wall_posts"("id") ON DELETE CASCADE,
        "user_id" varchar(255) REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("post_id", "user_id")
      );
    `);

    // ----- جدول إعجابات الغرف -----
    await client.query(`
      CREATE TABLE IF NOT EXISTS "room_likes" (
        "room_id" varchar(255) NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("room_id", "user_id")
      );
      CREATE INDEX IF NOT EXISTS "room_likes_room_idx" ON "room_likes" ("room_id");
    `);

    // ----- جدول المتابعين -----
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user_follows" (
        "follower_id" varchar(255) NOT NULL,
        "following_id" varchar(255) NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("follower_id", "following_id")
      );
      CREATE INDEX IF NOT EXISTS "user_follows_following_idx" ON "user_follows" ("following_id");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "profile_like_cooldowns" (
        "liker_id" varchar(255) NOT NULL,
        "profile_id" varchar(255) NOT NULL,
        "last_liked_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("liker_id", "profile_id")
      );
    `);

    // ----- جدول الإعجابات للـ wall posts (legacy bars) -----
    await client.query(`
      CREATE TABLE IF NOT EXISTS "bars_likes" (
        "bar_id" integer NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("bar_id", "user_id")
      );
      CREATE INDEX IF NOT EXISTS "bars_likes_bar_idx" ON "bars_likes" ("bar_id");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "bar_comment_likes" (
        "comment_id" bigint NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        PRIMARY KEY ("comment_id", "user_id")
      );
      CREATE INDEX IF NOT EXISTS "bar_comment_likes_comment_idx" ON "bar_comment_likes" ("comment_id");
    `);

    await applyDefaultMemberRoleMigration(client);

    // --- STORIES ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "stories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "author_id" varchar(255) NOT NULL,
        "media_url" text,
        "media_type" varchar(20) DEFAULT 'text' NOT NULL,
        "caption" text,
        "link_url" text,
        "bg_color" varchar(80) DEFAULT 'linear-gradient(135deg,#667eea,#764ba2)' NOT NULL,
        "text_color" varchar(20) DEFAULT '#ffffff' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "view_count" integer DEFAULT 0 NOT NULL,
        "like_count" integer DEFAULT 0 NOT NULL,
        "gift_count" integer DEFAULT 0 NOT NULL,
        "share_count" integer DEFAULT 0 NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "expires_at" timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "stories_author_idx" ON "stories" ("author_id");
      CREATE INDEX IF NOT EXISTS "stories_expires_idx" ON "stories" ("expires_at");
      CREATE INDEX IF NOT EXISTS "stories_active_idx" ON "stories" ("is_active");
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "story_views" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "story_id" uuid NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
        "viewer_id" varchar(255) NOT NULL,
        "viewer_name" varchar(255),
        "viewed_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "story_views_unique_idx" ON "story_views" ("story_id", "viewer_id");
      CREATE INDEX IF NOT EXISTS "story_views_story_idx" ON "story_views" ("story_id");
    `);

    try { await client.query(`ALTER TABLE "story_views" ADD COLUMN IF NOT EXISTS "viewer_name" varchar(255)`); } catch (_) {}

    await client.query(`
      CREATE TABLE IF NOT EXISTS "story_reactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "story_id" uuid NOT NULL REFERENCES "stories"("id") ON DELETE CASCADE,
        "user_id" varchar(255) NOT NULL,
        "user_name" varchar(255),
        "type" varchar(20) DEFAULT 'like' NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "story_reactions_unique_idx" ON "story_reactions" ("story_id", "user_id");
      CREATE INDEX IF NOT EXISTS "story_reactions_story_idx" ON "story_reactions" ("story_id");
    `);

    try { await client.query(`ALTER TABLE "story_reactions" ADD COLUMN IF NOT EXISTS "user_name" varchar(255)`); } catch (_) {}

    // --- تجهيز بيانات الأدمن للقصص عند أول تشغيل ---
    await client.query(`
      INSERT INTO "site_settings" ("key", "value")
      VALUES ('stories_enabled', 'true'::jsonb)
      ON CONFLICT ("key") DO NOTHING;
    `);

    // --- GIFT CATEGORIES ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "gift_categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    // --- GIFTS ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "gift_catalog" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "icon" text NOT NULL,
        "price" integer NOT NULL,
        "category_id" uuid REFERENCES "gift_categories"("id") ON DELETE SET NULL,
        "category" varchar(40) DEFAULT 'common' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
    `);
    // تعديل الجدول الموجود: تغيير نوع icon إلى text لدعم روابط الصور
    await client.query(`ALTER TABLE "gift_catalog" ALTER COLUMN "icon" TYPE text USING "icon"::text;`).catch((e: any) => console.warn("[Migration] تحذير: فشل تغيير نوع icon:", e.message));
    // إضافة عمود category_id إذا لم يكن موجوداً
    await client.query(`ALTER TABLE "gift_catalog" ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "gift_categories"("id") ON DELETE SET NULL;`).catch((e: any) => console.warn("[Migration] تحذير: فشل إضافة category_id:", e.message));

    // بذر الهدايا الافتراضية
    await client.query(`
      INSERT INTO "gift_categories" ("name") SELECT 'عام' WHERE NOT EXISTS (SELECT 1 FROM "gift_categories" WHERE "name" = 'عام');
    `);
    await client.query(`
      INSERT INTO "gift_catalog" ("name", "icon", "price", "category") VALUES
        ('وردة حمراء', '🌹', 10, 'common'),
        ('قلب ذهبي', '💖', 50, 'rare'),
        ('سيارة رياضية', '🏎️', 500, 'epic'),
        ('طائرة خاصة', '🛩️', 2000, 'legendary'),
        ('تاج الملك', '👑', 5000, 'legendary'),
        ('خاتم ألماس', '💎', 1000, 'epic')
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "gift_transactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "gift_id" uuid NOT NULL REFERENCES "gift_catalog"("id") ON DELETE CASCADE,
        "sender_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "receiver_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "quantity" integer DEFAULT 1 NOT NULL,
        "total_coins" integer NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "gift_transactions_sender_idx" ON "gift_transactions" ("sender_id");
      CREATE INDEX IF NOT EXISTS "gift_transactions_receiver_idx" ON "gift_transactions" ("receiver_id");
      CREATE INDEX IF NOT EXISTS "gift_transactions_created_idx" ON "gift_transactions" ("created_at");
    `);

    await ensureWalletLedgerSchema(client);

    // --- PRIVATE MESSAGES ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "private_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" varchar(512) NOT NULL,
        "sender_id" varchar(255) NOT NULL,
        "receiver_id" varchar(255) NOT NULL,
        "body" text NOT NULL,
        "read_at" timestamptz,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "pm_conversation_idx" ON "private_messages" ("conversation_id");
      CREATE INDEX IF NOT EXISTS "pm_sender_idx" ON "private_messages" ("sender_id");
      CREATE INDEX IF NOT EXISTS "pm_receiver_idx" ON "private_messages" ("receiver_id");
      CREATE INDEX IF NOT EXISTS "pm_created_idx" ON "private_messages" ("created_at");
    `);

    // --- INTERNAL MAIL ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "internal_mail" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sender_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "recipient_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "subject" varchar(255) NOT NULL,
        "body" text NOT NULL,
        "read_at" timestamptz,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "internal_mail_sender_idx" ON "internal_mail" ("sender_id");
      CREATE INDEX IF NOT EXISTS "internal_mail_recipient_idx" ON "internal_mail" ("recipient_id");
      CREATE INDEX IF NOT EXISTS "internal_mail_created_idx" ON "internal_mail" ("created_at");
    `);

    // --- CUTS (Shortcuts) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "cuts" (
        "id" SERIAL PRIMARY KEY,
        "shortcut" varchar(255) NOT NULL,
        "replacement" text NOT NULL,
        "description" varchar(500),
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "cuts_shortcut_idx" ON "cuts" ("shortcut");
    `);

    // --- NOTEXT (Filter Rules) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "notext" (
        "id" SERIAL PRIMARY KEY,
        "type" varchar(255),
        "path" varchar(50),
        "v" text
      );
    `);

    // --- HISTLETTER (Filter Logs) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "histletter" (
        "id" SERIAL PRIMARY KEY,
        "ip" varchar(255),
        "msg" text,
        "topic" varchar(255),
        "v" varchar(255),
        "time" varchar(255),
        "target" varchar(255),
        "source" varchar(255),
        "path" varchar(50)
      );
    `);

    // --- LOGS (Access/Activity Logs) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "logs" (
        "id" SERIAL PRIMARY KEY,
        "state" varchar(255),
        "topic" varchar(255),
        "username" varchar(255),
        "ip" varchar(255),
        "code" varchar(10),
        "device" varchar(500),
        "isin" varchar(255),
        "time" varchar(255)
      );
    `);

    // --- NOTIFICATIONS ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "actor_id" varchar(255) REFERENCES "users"("id") ON DELETE SET NULL,
        "type" varchar(40) NOT NULL,
        "entity_type" varchar(40) NOT NULL,
        "entity_id" varchar(128),
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "read_at" timestamptz,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" ("user_id");
      CREATE INDEX IF NOT EXISTS "notifications_read_idx" ON "notifications" ("user_id", "read_at");
      CREATE INDEX IF NOT EXISTS "notifications_created_idx" ON "notifications" ("created_at");
    `);

    // --- FILE MANAGER ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(255) NOT NULL,
        "folder_path" text DEFAULT '/' NOT NULL,
        "is_folder" boolean DEFAULT false NOT NULL,
        "mime_type" varchar(80),
        "size" integer DEFAULT 0 NOT NULL,
        "storage_path" text,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "files_user_idx" ON "files" ("user_id");
      CREATE INDEX IF NOT EXISTS "files_folder_idx" ON "files" ("folder_path");
    `);

    // ========== جداول الملصقات ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جداول الملصقات...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "sticker_categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "icon" text DEFAULT '😀',
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "stickers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "category_id" uuid NOT NULL REFERENCES "sticker_categories"("id") ON DELETE CASCADE,
        "name" varchar(100) DEFAULT '',
        "image_url" text NOT NULL,
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "stickers_category_idx" ON "stickers" ("category_id");
    `);

    // ========== جدول الايقونات ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جدول الايقونات...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "icons" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(200) DEFAULT '',
        "image_url" text NOT NULL,
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    // ========== جدول بنرات السوابر ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جدول بنرات السوابر...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "swiper_banners" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(200) DEFAULT '',
        "image_url" text NOT NULL,
        "link" text DEFAULT '',
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    // ========== جدول اطارات صورة البروفايل ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جدول اطارات صورة البروفايل...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "profile_frames" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(200) DEFAULT '',
        "image_url" text NOT NULL,
        "link" text DEFAULT '',
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    // ========== جدول ثيم بطاقة العضو ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جدول ثيم بطاقة العضو...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "member_card_themes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(200) DEFAULT '',
        "image_url" text NOT NULL,
        "link" text DEFAULT '',
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    // ========== جدول شارات الغرف (للتثبيت الجديد فقط) ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جدول شارات الغرف...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "room_badges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(200) DEFAULT '',
        "power" integer DEFAULT 0,
        "icon" text DEFAULT '',
        "bg" text DEFAULT '',
        "bg_type" varchar(20) DEFAULT 'static',
        "is_active" boolean DEFAULT true,
        "sort_order" integer DEFAULT 0,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    // ========== جداول الفيسات المتحركة ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء جدول الفيسات المتحركة...");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS "animated_faces" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "shortcut" varchar(10) NOT NULL UNIQUE,
        "name" varchar(100) DEFAULT '',
        "image_url" text NOT NULL,
        "is_active" boolean DEFAULT true,
        "sort_order" integer DEFAULT 0,
        "created_at" timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS "room_kicks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "room_id" varchar(128) NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "banned_until" timestamptz NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "room_kicks_room_user_idx" ON "room_kicks" ("room_id", "user_id");
      CREATE INDEX IF NOT EXISTS "room_kicks_banned_until_idx" ON "room_kicks" ("banned_until");
    `);

    // --- جدول room_mutes (الكتم الغرفي المنفصل عن الكتم العام) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS "room_mutes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "room_id" varchar(128) NOT NULL,
        "user_id" varchar(255) NOT NULL,
        "muted_by" varchar(255),
        "reason" text,
        "expires_at" timestamptz,
        "created_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "room_mutes_room_user_idx" ON "room_mutes" ("room_id", "user_id");
      CREATE INDEX IF NOT EXISTS "room_mutes_expires_idx" ON "room_mutes" ("expires_at");
    `);

    // ========== فهارس الأداء الحرجة ==========
    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] جاري إنشاء فهارس الأداء...");
    }

    const safeIndex = async (name: string, sql: string) => {
      try { await client.query(sql); }
      catch (e: any) { console.warn(`[Migration] تخطي الفهرس ${name}: ${e.message}`); }
    };

    // --- فهارس التعليقات (الأكثر استخداماً) ---
    await safeIndex("bar_comments_bar_id_idx", `CREATE INDEX IF NOT EXISTS "bar_comments_bar_id_idx" ON "bar_comments" ("bar_id", "id" ASC);`);

    // --- فهارس المستخدمين (تُستخدم في كل مكان) ---
    await safeIndex("users_uid_idx", `CREATE INDEX IF NOT EXISTS "users_uid_idx" ON "users" ("uid");`);
    await safeIndex("users_idreg_idx", `CREATE INDEX IF NOT EXISTS "users_idreg_idx" ON "users" ("idreg");`);
    await safeIndex("users_username_lower_idx", `CREATE INDEX IF NOT EXISTS "users_username_lower_idx" ON "users" (LOWER("username"));`);
    await safeIndex("users_topic_lower_idx", `CREATE INDEX IF NOT EXISTS "users_topic_lower_idx" ON "users" (LOWER("topic"));`);

    // --- فهارس الرسائل الخاصة ---
    await safeIndex("pm_conv_created_idx", `CREATE INDEX IF NOT EXISTS "pm_conv_created_idx" ON "private_messages" ("conversation_id", "created_at" DESC);`);
    await safeIndex("pm_receiver_read_idx", `CREATE INDEX IF NOT EXISTS "pm_receiver_read_idx" ON "private_messages" ("receiver_id", "read_at") WHERE "read_at" IS NULL;`);
    await safeIndex("pm_conv_receiver_read_idx", `CREATE INDEX IF NOT EXISTS "pm_conv_receiver_read_idx" ON "private_messages" ("conversation_id", "receiver_id", "read_at");`);

    // --- فهارس البريد الداخلي ---
    await safeIndex("mail_recipient_created_idx", `CREATE INDEX IF NOT EXISTS "mail_recipient_created_idx" ON "internal_mail" ("recipient_id", "created_at" DESC);`);
    await safeIndex("mail_sender_created_idx", `CREATE INDEX IF NOT EXISTS "mail_sender_created_idx" ON "internal_mail" ("sender_id", "created_at" DESC);`);
    await safeIndex("mail_recipient_read_idx", `CREATE INDEX IF NOT EXISTS "mail_recipient_read_idx" ON "internal_mail" ("recipient_id", "read_at") WHERE "read_at" IS NULL;`);

    // --- فهارس الإشعارات ---
    await safeIndex("notifications_user_created_idx", `CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);`);

    // --- فهارس الملفات ---
    await safeIndex("files_user_folder_idx", `CREATE INDEX IF NOT EXISTS "files_user_folder_idx" ON "files" ("user_id", "folder_path", "is_folder", "name");`);

    // --- فهارس القصص ---
    await safeIndex("stories_active_expires_created_idx", `CREATE INDEX IF NOT EXISTS "stories_active_expires_created_idx" ON "stories" ("is_active", "expires_at", "created_at" DESC) WHERE "is_active" = true;`);
    await safeIndex("stories_author_active_created_idx", `CREATE INDEX IF NOT EXISTS "stories_author_active_created_idx" ON "stories" ("author_id", "is_active", "created_at" DESC) WHERE "is_active" = true;`);

    // --- فهارس الصلاحيات ---
    await safeIndex("ura_user_idreg_idx", `CREATE INDEX IF NOT EXISTS "ura_user_idreg_idx" ON "user_role_assignments" ("user_id");`);

    // --- فهارس لوحة التحكم ---
    await safeIndex("moderation_events_created_idx", `CREATE INDEX IF NOT EXISTS "moderation_events_created_idx" ON "moderation_events" ("created_at" DESC);`);
    await safeIndex("admin_audit_logs_created_idx", `CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_idx" ON "admin_audit_logs" ("created_at" DESC);`);
    await safeIndex("moderation_bans_created_idx", `CREATE INDEX IF NOT EXISTS "moderation_bans_created_idx" ON "moderation_bans" ("created_at" DESC);`);
    await safeIndex("moderation_bans_active_expires_idx", `CREATE INDEX IF NOT EXISTS "moderation_bans_active_expires_idx" ON "moderation_bans" ("is_active", "expires_at") WHERE "is_active" = true;`);

    // --- فهارس سجلات الوصول ---
    await safeIndex("logs_time_idx", `CREATE INDEX IF NOT EXISTS "logs_time_idx" ON "logs" ("time" DESC);`);
    await safeIndex("logs_username_idx", `CREATE INDEX IF NOT EXISTS "logs_username_idx" ON "logs" ("username");`);
    await safeIndex("logs_state_idx", `CREATE INDEX IF NOT EXISTS "logs_state_idx" ON "logs" ("state");`);

    // --- فهارس الهدايا ---
    await safeIndex("gift_catalog_active_price_idx", `CREATE INDEX IF NOT EXISTS "gift_catalog_active_price_idx" ON "gift_catalog" ("is_active", "price") WHERE "is_active" = true;`);

    // --- فهارس الجلسات ---
    await safeIndex("tokens_token_expires_idx", `CREATE INDEX IF NOT EXISTS "tokens_token_expires_idx" ON "tokens" ("token", "expires_at");`);

    // --- فهارس البوتات ---
    await safeIndex("bots_idreg_idx", `CREATE INDEX IF NOT EXISTS "bots_idreg_idx" ON "bots" ("idreg");`);

    // --- فهارس إعجابات التعليقات ---
    await safeIndex("bar_comment_likes_comment_idx", `CREATE INDEX IF NOT EXISTS "bar_comment_likes_comment_idx" ON "bar_comment_likes" ("comment_id");`);

    if (process.env.MIGRATION_LOGS === "1") {
      console.log("[Migration] ✅ تم إنشاء فهارس الأداء بنجاح");
      console.log("[Migration] ✅ تم فحص وإنشاء جميع الجداول الناقصة بنجاح");
    }
  } catch (error) {
    console.error("[Migration] ❌ خطأ أثناء تشغيل الـ migrations:", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyDatabaseSchema() {
  const requiredTables = [
    "users",
    "user_profiles",
    "profile_visits",
    "user_verifications",
    "social_edges",
    "social_affinity",
    "social_clusters",
    "interaction_heat",
    "influence_scores",
    "identity_effects",
    "user_identity_state",
    "behavior_scores",
    "activity_stream",
    "event_store",
    "event_snapshots",
    "event_replays",
    "rooms",
    "moderation_bans",
    "moderation_events",
    "site_settings",
    "voice_provider_accounts",
    "voice_provider_selection",
    "chat_bots",
    "moderation_filters",
    "admin_audit_logs",
    "wall_posts",
    "wall_comments",
    "wall_post_likes",
    "room_likes",
    "user_follows",
    "profile_like_cooldowns",
    "roles",
    "role_permissions",
    "user_role_assignments",
    "stories",
    "story_views",
    "story_reactions",
    "gift_categories",
    "gift_catalog",
    "gift_transactions",
    "wallet_settings",
    "wallet_operations",
    "wallet_balances",
    "wallet_entries",
    "cash_accounts",
    "cash_operations",
    "cash_entries",
    "wallet_agent_packages",
    "wallet_agent_inventory_orders",
    "member_coin_purchases",
    "private_messages",
    "internal_mail",
    "cuts",
    "files",
    "notifications",
    "sticker_categories",
    "stickers",
    "room_badges",
    "animated_faces",
    "swiper_banners",
    "profile_frames",
    "member_card_themes",
    "icons",
    "bars",
    "bar_comments",
    "bars_likes",
    "bar_comment_likes",
    "logs",
    "room_kicks",
  ];

  const client = await dbPool.connect();
  try {
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1);`,
      [requiredTables],
    );

    const existingTables = result.rows.map((row: { table_name: string }) => row.table_name);
    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));
    const requiredWalletColumns = [["wallet_operations", "metadata"]];
    const requiredCashColumns = [
      ["cash_accounts", "owner_type"],
      ["cash_accounts", "owner_user_id"],
      ["cash_accounts", "owner_agent_id"],
      ["cash_accounts", "owner_reference"],
      ["cash_accounts", "bucket"],
      ["cash_accounts", "currency_code"],
      ["cash_accounts", "balance_minor_units"],
      ["cash_accounts", "updated_at"],
      ["cash_operations", "actor_scope"],
      ["cash_operations", "actor_user_id"],
      ["cash_operations", "actor_agent_id"],
      ["cash_operations", "operation_type"],
      ["cash_operations", "idempotency_key"],
      ["cash_operations", "currency_code"],
      ["cash_operations", "request_fingerprint"],
      ["cash_operations", "reference_type"],
      ["cash_operations", "reference_id"],
      ["cash_operations", "metadata"],
      ["cash_operations", "created_at"],
      ["cash_entries", "operation_id"],
      ["cash_entries", "cash_account_id"],
      ["cash_entries", "currency_code"],
      ["cash_entries", "amount_minor_units"],
      ["cash_entries", "reversal_of_entry_id"],
      ["cash_entries", "created_at"],
    ];
    const walletColumnsResult = await client.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1);`,
      [[...new Set(
        [...requiredWalletColumns, ...requiredCashColumns].map(([tableName]) => tableName),
      )]],
    );
    const existingWalletColumns = new Set(
      walletColumnsResult.rows.map((row: { table_name: string; column_name: string }) =>
        `${row.table_name}:${row.column_name}`,
      ),
    );
    const missingWalletColumns = requiredWalletColumns
      .map(([tableName, columnName]) => `${tableName}:${columnName}`)
      .filter((column) => !existingWalletColumns.has(column));
    const missingCashColumns = requiredCashColumns
      .map(([tableName, columnName]) => `${tableName}:${columnName}`)
      .filter((column) => !existingWalletColumns.has(column));
    const requiredWalletGuards = [
      ["wallet_operations", "wallet_operations_immutable"],
      ["wallet_operations", "wallet_operations_no_truncate"],
      ["wallet_entries", "wallet_entries_immutable"],
      ["wallet_entries", "wallet_entries_no_truncate"],
      ["user_profiles", "user_profiles_legacy_coins_update_fence"],
      ["user_profiles", "user_profiles_legacy_coins_insert_fence"],
    ];
    const requiredCashGuards = [
      ["cash_accounts", "cash_accounts_identity_immutable"],
      ["cash_accounts", "cash_accounts_no_truncate"],
      ["cash_operations", "cash_operations_immutable"],
      ["cash_operations", "cash_operations_no_truncate"],
      ["cash_entries", "cash_entries_immutable"],
      ["cash_entries", "cash_entries_no_truncate"],
    ];
    const triggerResult = await client.query(
      `SELECT c.relname AS table_name, t.tgname AS trigger_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
    );
    const existingGuards = new Set(
      triggerResult.rows.map((row: { table_name: string; trigger_name: string }) =>
        `${row.table_name}:${row.trigger_name}`,
      ),
    );
    const missingWalletGuards = requiredWalletGuards
      .map(([tableName, triggerName]) => `${tableName}:${triggerName}`)
      .filter((guard) => !existingGuards.has(guard));
    const missingCashGuards = requiredCashGuards
      .map(([tableName, triggerName]) => `${tableName}:${triggerName}`)
      .filter((guard) => !existingGuards.has(guard));

    return {
      existingTables,
      missingTables,
      missingWalletColumns,
      missingWalletGuards,
      missingCashColumns,
      missingCashGuards,
    };
  } finally {
    client.release();
  }
}

/**
 * تأكد من وجود الاعمدة الجديدة في جدول شارات الغرف
 * تعمل بشكل مستقل عن auto-migration لتحديث الجدول القديم
 */
export async function ensureRoomBadgesColumns() {
  const client = await dbPool.connect();
  try {
    await client.query(`ALTER TABLE "room_badges" ADD COLUMN IF NOT EXISTS "power" integer DEFAULT 0;`);
    await client.query(`ALTER TABLE "room_badges" ADD COLUMN IF NOT EXISTS "icon" text DEFAULT '';`);
    await client.query(`ALTER TABLE "room_badges" ADD COLUMN IF NOT EXISTS "bg" text DEFAULT '';`);
    await client.query(`ALTER TABLE "room_badges" ADD COLUMN IF NOT EXISTS "bg_type" varchar(20) DEFAULT 'static';`);
    await client.query(`ALTER TABLE "room_badges" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;`);
    await client.query(`ALTER TABLE "room_badges" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0;`);
    await client.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='room_badges' AND column_name='icon_url') THEN ALTER TABLE "room_badges" RENAME COLUMN "icon_url" TO "icon"; END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='room_badges' AND column_name='background') THEN ALTER TABLE "room_badges" RENAME COLUMN "background" TO "bg"; END IF; END $$;`);
    await client.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='room_badges' AND column_name='background_type') THEN ALTER TABLE "room_badges" RENAME COLUMN "background_type" TO "bg_type"; END IF; END $$;`);
  } catch (err) {
    // تجاهل الخطأ: الجدول قد لا يكون موجوداً اصلاً
  } finally {
    client.release();
  }
}

export async function ensureUserProfilesColumns() {
  const client = await dbPool.connect();
  try {
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "member_card_bg_url" text;`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "avatar_frame_url" text;`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "name_color" varchar(20);`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "message_color" varchar(20);`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "status_font_color" varchar(20);`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "gifted_banner_url" text;`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "gifted_gift_icon_url" text;`);
    await client.query(`ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "gifted_promotion_icon_url" text;`);
    // Populate name_color and message_color from legacy users table for existing rows
    await client.query(`UPDATE "user_profiles" SET "name_color" = "users"."ucol" FROM "users" WHERE CAST("users"."id" AS text) = "user_profiles"."user_id" AND ("user_profiles"."name_color" IS NULL OR "user_profiles"."name_color" = '')`);
    await client.query(`UPDATE "user_profiles" SET "message_color" = "users"."mcol" FROM "users" WHERE CAST("users"."id" AS text) = "user_profiles"."user_id" AND ("user_profiles"."message_color" IS NULL OR "user_profiles"."message_color" = '')`);
  } catch (err) {
    // تجاهل الخطأ
  } finally {
    client.release();
  }
}

export async function ensureRoomAndMemberFeatures() {
  const client = await dbPool.connect();
  try {
    // 1. الأعمدة الإضافية لجدول الغرف
    await client.query('ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "cover_url" text;');
    await client.query('ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL;');
    await client.query('ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "exp" integer DEFAULT 0 NOT NULL;');
    await client.query('ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "badge_id" uuid;');
    await client.query('ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "pinned_announcement" text;');

    // 2. الأعمدة الإضافية لملفات المستخدمين
    await client.query('ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL;');
    await client.query('ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "exp" integer DEFAULT 0 NOT NULL;');

    // 3. جدول أعضاء وصلاحيات الغرفة
    await client.query(`
      CREATE TABLE IF NOT EXISTS "room_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "room_id" uuid NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
        "user_id" varchar(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "role" varchar(40) DEFAULT 'member' NOT NULL,
        "power" integer DEFAULT 1000 NOT NULL,
        "custom_title" varchar(120),
        "badge_id" uuid REFERENCES "room_badges"("id") ON DELETE SET NULL,
        "joined_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "room_members_room_user_idx" ON "room_members" ("room_id", "user_id");');
    await client.query('CREATE INDEX IF NOT EXISTS "room_members_user_idx" ON "room_members" ("user_id");');
    await client.query('CREATE INDEX IF NOT EXISTS "room_members_room_idx" ON "room_members" ("room_id");');
    await ensureRoomCustomRolesSchema(client);
  } catch (err) {
    console.error("[DB] ensureRoomAndMemberFeatures error:", err);
  } finally {
    client.release();
  }
}

export async function ensureRoomCustomRolesSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "room_custom_roles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "room_id" uuid NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
      "name" varchar(64) NOT NULL,
      "color" varchar(7) DEFAULT '#64748b' NOT NULL,
      "power_level" integer DEFAULT 1000 NOT NULL,
      "permissions" jsonb DEFAULT
        '{"canKick":false,"canMute":false,"canManageMics":false,"canPin":false,"canClearMessages":false,"canBan":false}'::jsonb
        NOT NULL,
      "created_at" timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT "room_custom_roles_name_check"
        CHECK (length(trim("name")) BETWEEN 1 AND 64),
      CONSTRAINT "room_custom_roles_color_check"
        CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
      CONSTRAINT "room_custom_roles_power_check"
        CHECK ("power_level" BETWEEN 1 AND 99999),
      CONSTRAINT "room_custom_roles_permissions_check"
        CHECK (
          jsonb_typeof("permissions") = 'object'
          AND jsonb_object_length("permissions") = 6
          AND jsonb_typeof("permissions"->'canKick') = 'boolean'
          AND jsonb_typeof("permissions"->'canMute') = 'boolean'
          AND jsonb_typeof("permissions"->'canManageMics') = 'boolean'
          AND jsonb_typeof("permissions"->'canPin') = 'boolean'
          AND jsonb_typeof("permissions"->'canClearMessages') = 'boolean'
          AND jsonb_typeof("permissions"->'canBan') = 'boolean'
        )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "room_custom_roles_room_name_idx"
      ON "room_custom_roles" ("room_id", lower("name"));
    CREATE INDEX IF NOT EXISTS "room_custom_roles_room_power_idx"
      ON "room_custom_roles" ("room_id", "power_level");
  `);
  await client.query(`
    ALTER TABLE "room_members"
    ADD COLUMN IF NOT EXISTS "custom_role_id" uuid
      REFERENCES "room_custom_roles"("id") ON DELETE SET NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "room_members_custom_role_idx"
      ON "room_members" ("custom_role_id")
  `);
}

export async function ensureUserIdentityAndConsolidation() {
  const client = await dbPool.connect();
  try {
    // 1. Add mention_name and public_user_id columns if not exist
    await client.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mention_name" varchar(64);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "public_user_id" varchar(12);
    `);

    // 2. Sync display_name from topic where topic exists and differs
    await client.query(`
      UPDATE users 
      SET display_name = topic 
      WHERE topic IS NOT NULL AND topic != '' AND display_name != topic;
    `);

    // 3. Backfill mention_name and public_user_id for all users where NULL
    const missing = await client.query(`
      SELECT id, username, display_name, topic, mention_name, public_user_id 
      FROM users 
      WHERE mention_name IS NULL OR public_user_id IS NULL;
    `);

    if (missing.rows.length > 0) {
      const { generatePublicUserId, sanitizeMentionName } = await import("../services/publicIdService");
      
      const existingRes = await client.query(`SELECT mention_name, public_user_id FROM users;`);
      const existingMentions = new Set(existingRes.rows.map((r: any) => r.mention_name?.toLowerCase()).filter(Boolean));
      const existingPublicIds = new Set(existingRes.rows.map((r: any) => r.public_user_id).filter(Boolean));

      for (const row of missing.rows) {
        let mention = row.mention_name;
        if (!mention) {
          const base = sanitizeMentionName(row.display_name || row.topic, sanitizeMentionName(row.username));
          mention = base;
          let counter = 1;
          while (existingMentions.has(mention.toLowerCase())) {
            mention = `${base.slice(0, 28)}_${counter++}`;
          }
          existingMentions.add(mention.toLowerCase());
        }

        let pubId = row.public_user_id;
        if (!pubId) {
          let attempts = 0;
          do {
            pubId = generatePublicUserId();
            attempts++;
          } while (existingPublicIds.has(pubId) && attempts < 5);
          existingPublicIds.add(pubId);
        }

        await client.query(
          `UPDATE users SET mention_name = $1, public_user_id = $2 WHERE id = $3`,
          [mention, pubId, row.id]
        );
      }
    }

    // 4. Create unique indexes
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_mention_name_lower_idx" ON "users" (LOWER("mention_name"));
      CREATE UNIQUE INDEX IF NOT EXISTS "users_public_user_id_idx" ON "users" ("public_user_id");
      CREATE INDEX IF NOT EXISTS "users_display_name_lower_idx" ON "users" (LOWER("display_name"));
    `);

    console.log("[DB] ensureUserIdentityAndConsolidation complete.");
  } catch (err) {
    console.error("[DB] ensureUserIdentityAndConsolidation error:", err);
  } finally {
    client.release();
  }
}
