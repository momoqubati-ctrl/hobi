import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { roles } from "../server/db/schema";
import type { PoolClient } from "pg";

test("roles have a bounded announcement daily limit defaulting to zero", () => {
  const config = getTableConfig(roles);
  const limit = config.columns.find((column) => column.name === "announcement_daily_limit");

  assert.ok(limit);
  assert.equal(limit.getSQLType(), "integer");
  assert.equal(limit.notNull, true);
  assert.equal(limit.default, 0);
  assert.ok(config.checks.some((constraint) => constraint.name === "roles_announcement_daily_limit_check"));
});

test("announcement role limit migration is additive and idempotent", async () => {
  const { ensureAnnouncementRoleLimitSchema } = await import("../server/db/migrate");
  const statements: string[] = [];
  const client = {
    query: async (statement: string) => {
      statements.push(statement);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;

  await ensureAnnouncementRoleLimitSchema(client);

  assert.equal(statements.length, 2);
  assert.match(statements[0], /ADD COLUMN IF NOT EXISTS "announcement_daily_limit"/);
  assert.match(statements[1], /roles_announcement_daily_limit_check/);
  assert.match(statements[1], /IF NOT EXISTS/);
});
