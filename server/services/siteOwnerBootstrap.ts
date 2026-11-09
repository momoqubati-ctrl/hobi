import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";
import { invalidatePermissionCache } from "./permissionEngine";
import {
  SITE_OWNER_DISPLAY_NAME,
  SITE_OWNER_RANK,
  SITE_OWNER_ROLE_NAME,
  type SiteOwnerBootstrapConfig,
} from "./siteOwner";

const BOOTSTRAP_MARKER = "site_owner_bootstrap";

export class SiteOwnerBootstrapError extends Error {
  constructor(
    readonly code: "SITE_OWNER_USERNAME_CONFLICT" | "SITE_OWNER_ROLE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "SiteOwnerBootstrapError";
  }
}

export async function provisionSiteOwner(
  client: Pick<PoolClient, "query">,
  config: SiteOwnerBootstrapConfig,
  permissionKeys: readonly string[],
): Promise<string> {
  await client.query("BEGIN");

  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`hobi-site-owner-bootstrap:${config.username}`],
    );
    await client.query(`SELECT set_config('hobi.site_owner_bootstrap', 'on', true)`);

    const roleResult = await client.query(
      `SELECT "id", "legacy_metadata"->>'managed_by' AS "managedBy"
       FROM "roles"
       WHERE "name" = $1
       LIMIT 1
       FOR UPDATE`,
      [SITE_OWNER_ROLE_NAME],
    );
    const existingRole = roleResult.rows[0];
    if (existingRole && existingRole.managedBy !== BOOTSTRAP_MARKER) {
      throw new SiteOwnerBootstrapError(
        "SITE_OWNER_ROLE_CONFLICT",
        "The reserved site-owner role name is already in use.",
      );
    }

    const userResult = await client.query(
      `SELECT "id"
       FROM "users"
       WHERE lower(trim("username")) = $1
       LIMIT 1
       FOR UPDATE`,
      [config.username],
    );
    const existingUser = userResult.rows[0];

    if (existingUser) {
      if (!existingRole) {
        throw new SiteOwnerBootstrapError(
          "SITE_OWNER_USERNAME_CONFLICT",
          "The configured site-owner username already belongs to another account.",
        );
      }

      const assignmentResult = await client.query(
        `SELECT 1
         FROM "user_role_assignments"
         WHERE "user_id" = $1 AND "role_id" = $2
         LIMIT 1`,
        [existingUser.id, existingRole.id],
      );
      if (assignmentResult.rowCount === 0) {
        throw new SiteOwnerBootstrapError(
          "SITE_OWNER_USERNAME_CONFLICT",
          "The configured site-owner username already belongs to another account.",
        );
      }
    }

    const ensuredRole = await client.query(
      `INSERT INTO "roles"
        ("legacy_name", "name", "rank", "icon_url", "is_system", "is_default",
         "is_owner", "is_active", "auto_enabled", "auto_promote", "auto_points",
         "legacy_metadata")
       VALUES ($1, $2, $3, '', true, false, false, true, false, false, 0,
               jsonb_build_object('managed_by', $4::text))
       ON CONFLICT ("name") DO UPDATE
         SET "legacy_name" = EXCLUDED."legacy_name",
             "rank" = EXCLUDED."rank",
             "is_system" = true,
             "is_default" = false,
             "is_owner" = false,
             "is_active" = true,
             "auto_enabled" = false,
             "auto_promote" = false,
             "auto_points" = 0,
             "legacy_metadata" = "roles"."legacy_metadata" || EXCLUDED."legacy_metadata",
             "updated_at" = now()
         WHERE "roles"."legacy_metadata"->>'managed_by' = $4::text
       RETURNING "id"`,
      [SITE_OWNER_DISPLAY_NAME, SITE_OWNER_ROLE_NAME, SITE_OWNER_RANK, BOOTSTRAP_MARKER],
    );
    const roleId = String(ensuredRole.rows[0]?.id || existingRole?.id || "");
    if (!roleId) {
      throw new SiteOwnerBootstrapError(
        "SITE_OWNER_ROLE_CONFLICT",
        "The reserved site-owner role could not be provisioned.",
      );
    }

    let userId: string;
    if (existingUser) {
      userId = String(existingUser.id);
      await client.query(
        `UPDATE "users"
         SET "display_name" = $2, "topic" = $2, "updated_at" = now()
         WHERE "id" = $1`,
        [userId, SITE_OWNER_DISPLAY_NAME],
      );
    } else {
      userId = randomUUID();
      const insertedUser = await client.query(
        `INSERT INTO "users"
          ("id", "username", "display_name", "password", "password_hash",
           "power", "topic", "pic", "pich", "msg")
          VALUES ($1, $2, $3, $4, $5, '', $3, '/pic.png', '/pich.png', '(عضو جديد)')
         RETURNING "id"`,
        [
          userId,
          config.username,
          SITE_OWNER_DISPLAY_NAME,
          config.passwordHash,
          config.passwordHash,
        ],
      );
      userId = String(insertedUser.rows[0]?.id || "");
      if (!userId) throw new Error("Site-owner account insert returned no identifier.");
    }

    await client.query(
      `INSERT INTO "user_profiles" ("user_id", "profile_msg", "avatar_url", "banner_url")
       VALUES ($1, '(عضو جديد)', '/pic.png', '/pich.png')
       ON CONFLICT ("user_id") DO NOTHING`,
      [userId],
    );

    const normalizedPermissionKeys = [...new Set(permissionKeys)]
      .filter((permissionKey) => !permissionKey.startsWith("hosting_owner."));
    await client.query(
      `DELETE FROM "role_permissions"
       WHERE "role_id" = $1 AND NOT ("permission_key" = ANY($2::text[]))`,
      [roleId, normalizedPermissionKeys],
    );
    await client.query(
      `INSERT INTO "role_permissions"
        ("role_id", "permission_key", "permission_value", "source")
       SELECT $1, permission_key, 'true'::jsonb, $3
       FROM unnest($2::text[]) AS permission_key
       ON CONFLICT ("role_id", "permission_key") DO UPDATE
         SET "permission_value" = 'true'::jsonb, "source" = EXCLUDED."source"`,
      [roleId, normalizedPermissionKeys, BOOTSTRAP_MARKER],
    );
    await client.query(
      `INSERT INTO "user_role_assignments" ("user_id", "role_id", "legacy_metadata")
       VALUES ($1, $2, jsonb_build_object('source', $3::text))
       ON CONFLICT ("user_id", "role_id") DO UPDATE
         SET "starts_at" = LEAST("user_role_assignments"."starts_at", now()),
             "expires_at" = NULL,
             "legacy_metadata" = EXCLUDED."legacy_metadata"`,
      [userId, roleId, BOOTSTRAP_MARKER],
    );

    await client.query("COMMIT");
    return userId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function ensureSiteOwnerBootstrap(
  config: SiteOwnerBootstrapConfig,
  permissionKeys: readonly string[],
): Promise<string> {
  const client = await dbPool.connect();
  let userId: string;
  try {
    userId = await provisionSiteOwner(client, config, permissionKeys);
  } finally {
    client.release();
  }

  await invalidatePermissionCache(userId);
  return userId;
}
