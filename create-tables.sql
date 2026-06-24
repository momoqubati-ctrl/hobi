CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" varchar(255) PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "idreg" varchar(40),
  "lid" varchar(40),
  "uid" varchar(40),
  "bio" text,
  "stealth" boolean DEFAULT false,
  "avatar_url" text,
  "banner_url" text,
  "coins" integer DEFAULT 0,
  "power" varchar(80),
  "updated_at" timestamptz DEFAULT now()
);
