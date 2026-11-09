import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import {
  announcementDailyUsage,
  announcementIdempotency,
  announcementRecipients,
  announcements,
} from "../server/db/schema";

test("announcement records retain only the sender snapshot and message", () => {
  const config = getTableConfig(announcements);
  const columns = new Set(config.columns.map((column) => column.name));
  const checks = new Set(config.checks.map((constraint) => constraint.name));

  assert.equal(config.name, "announcements");
  assert.ok(columns.has("type"));
  assert.ok(columns.has("message"));
  assert.ok(columns.has("sender_name"));
  assert.ok(columns.has("sender_avatar_url"));
  assert.ok(columns.has("created_at"));
  assert.ok(checks.has("announcements_type_check"));
  assert.ok(checks.has("announcements_message_length_check"));
});

test("announcement recipients are unique per announcement and account", () => {
  const config = getTableConfig(announcementRecipients);
  const columns = new Set(config.columns.map((column) => column.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.equal(config.name, "announcement_recipients");
  assert.ok(columns.has("announcement_id"));
  assert.ok(columns.has("recipient_user_id"));
  assert.equal(indexes.get("announcement_recipients_user_idx")?.unique, true);
});

test("daily announcement usage is scoped by account and Riyadh date", () => {
  const config = getTableConfig(announcementDailyUsage);
  const columns = new Set(config.columns.map((column) => column.name));
  const checks = new Set(config.checks.map((constraint) => constraint.name));

  assert.equal(config.name, "announcement_daily_usage");
  assert.ok(columns.has("user_id"));
  assert.ok(columns.has("usage_date"));
  assert.ok(columns.has("send_count"));
  assert.equal(
    config.columns.find((column) => column.name === "send_count")?.default,
    0,
  );
  assert.ok(checks.has("announcement_daily_usage_nonnegative_check"));
});

test("announcement idempotency records scope keys to senders and expire", () => {
  const config = getTableConfig(announcementIdempotency);
  const columns = new Set(config.columns.map((column) => column.name));
  const indexes = new Map(config.indexes.map((index) => [index.config.name, index.config]));

  assert.equal(config.name, "announcement_idempotency");
  assert.ok(columns.has("sender_user_id"));
  assert.ok(columns.has("idempotency_key"));
  assert.ok(columns.has("request_fingerprint"));
  assert.ok(columns.has("response"));
  assert.ok(columns.has("expires_at"));
  assert.equal(indexes.get("announcement_idempotency_sender_key_idx")?.unique, true);
  assert.ok(indexes.has("announcement_idempotency_expiry_idx"));
});

test("announcement delivery migration creates every table and index idempotently", async () => {
  const { ensureAnnouncementDeliverySchema } = await import("../server/db/migrate");
  const statements: string[] = [];
  const client = {
    query: async (statement: string) => {
      statements.push(statement);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;

  await ensureAnnouncementDeliverySchema(client);

  const migrationSql = statements.join("\n");
  for (const table of [
    "announcements",
    "announcement_recipients",
    "announcement_daily_usage",
    "announcement_idempotency",
  ]) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS/);
});
