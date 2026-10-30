import { dbPool } from "./index";

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "legacy_name" varchar(120),
        "name" varchar(120) NOT NULL,
        "rank" integer DEFAULT 0 NOT NULL,
        "icon_url" text DEFAULT '' NOT NULL,
        "is_system" boolean DEFAULT false NOT NULL,
        "auto_enabled" boolean DEFAULT false NOT NULL,
        "auto_promote" boolean DEFAULT false NOT NULL,
        "auto_points" integer DEFAULT 0 NOT NULL,
        "legacy_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_idx" ON "roles" ("name");
      CREATE INDEX IF NOT EXISTS "roles_rank_idx" ON "roles" ("rank");
    `);

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
    "roles",
    "role_permissions",
    "user_role_assignments",
    "stories",
    "story_views",
    "story_reactions",
    "gift_categories",
    "gift_catalog",
    "gift_transactions",
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

    return {
      existingTables,
      missingTables,
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
  } catch (err) {
    console.error("[DB] ensureRoomAndMemberFeatures error:", err);
  } finally {
    client.release();
  }
}
