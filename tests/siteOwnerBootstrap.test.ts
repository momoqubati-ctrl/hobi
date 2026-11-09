import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getSiteOwnerPermissionKeys,
  getConfiguredSiteOwnerUsername,
  getSiteOwnerBootstrapConfig,
  isSiteOwnerUsername,
} from "../server/services/siteOwner";
import { createGuestSession, registerMember } from "../server/services/authService";
import { isReservedOwnerRoleName } from "../server/services/systemOwner";
import { provisionSiteOwner } from "../server/services/siteOwnerBootstrap";
import type { PoolClient } from "pg";

const VALID_HASH = `${"a".repeat(32)}:${"b".repeat(128)}`;
const SITE_OWNER_CONFIG = { username: "site.owner", passwordHash: VALID_HASH };

type BootstrapState = {
  roles: Array<{ id: string; name: string; managedBy: string; isOwner: boolean }>;
  users: Array<{ id: string; username: string; passwordHash: string }>;
  profiles: string[];
  assignments: Array<{ userId: string; roleId: string }>;
  permissions: Array<{ roleId: string; key: string }>;
};

function createBootstrapClient(seed: Partial<BootstrapState> = {}, failOnProfileInsert = false) {
  const state: BootstrapState = {
    roles: seed.roles || [],
    users: seed.users || [],
    profiles: seed.profiles || [],
    assignments: seed.assignments || [],
    permissions: seed.permissions || [],
  };
  let snapshot: BootstrapState | null = null;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql === "BEGIN") {
        snapshot = structuredClone(state);
      } else if (sql === "ROLLBACK" && snapshot) {
        Object.assign(state, snapshot);
        snapshot = null;
      } else if (sql === "COMMIT") {
        snapshot = null;
      } else if (sql.includes('FROM "roles"') && sql.includes('WHERE "name" = $1')) {
        return {
          rows: state.roles.filter((role) => role.name === values[0]),
          rowCount: 1,
        };
      } else if (sql.includes('FROM "users"') && sql.includes('lower(trim("username"))')) {
        return {
          rows: state.users.filter((user) => user.username.trim().toLowerCase() === values[0]),
          rowCount: 1,
        };
      } else if (sql.includes('FROM "user_role_assignments"') && sql.includes('WHERE "user_id" = $1')) {
        const present = state.assignments.some((assignment) =>
          assignment.userId === values[0] && assignment.roleId === values[1],
        );
        return { rows: present ? [{ present: true }] : [], rowCount: present ? 1 : 0 };
      } else if (sql.includes('INSERT INTO "roles"')) {
        assert.match(sql, /jsonb_build_object\('managed_by', \$4::text\)/);
        const existingRole = state.roles.find((role) => role.name === values[1]);
        if (existingRole) return { rows: [{ id: existingRole.id }], rowCount: 1 };
        const role = {
          id: "00000000-0000-4000-8000-000000000001",
          name: String(values[1]),
          managedBy: "site_owner_bootstrap",
          isOwner: false,
        };
        state.roles.push(role);
        return { rows: [{ id: role.id }], rowCount: 1 };
      } else if (sql.includes('INSERT INTO "users"')) {
        assert.equal(values.length, 5);
        assert.equal(values[3], values[4]);
        const user = {
          id: String(values[0]),
          username: String(values[1]),
          passwordHash: String(values[4]),
        };
        state.users.push(user);
        return { rows: [{ id: user.id }], rowCount: 1 };
      } else if (sql.includes('INSERT INTO "user_profiles"')) {
        if (failOnProfileInsert) throw new Error("profile write failed");
        const userId = String(values[0]);
        if (!state.profiles.includes(userId)) state.profiles.push(userId);
      } else if (sql.includes('DELETE FROM "role_permissions"')) {
        const roleId = String(values[0]);
        const keep = new Set(values[1] as string[]);
        state.permissions = state.permissions.filter(
          (permission) => permission.roleId !== roleId || keep.has(permission.key),
        );
      } else if (sql.includes('INSERT INTO "role_permissions"')) {
        const roleId = String(values[0]);
        for (const key of values[1] as string[]) {
          if (!state.permissions.some((permission) => permission.roleId === roleId && permission.key === key)) {
            state.permissions.push({ roleId, key });
          }
        }
      } else if (sql.includes('INSERT INTO "user_role_assignments"')) {
        assert.match(sql, /jsonb_build_object\('source', \$3::text\)/);
        const assignment = { userId: String(values[0]), roleId: String(values[1]) };
        if (!state.assignments.some((item) => item.userId === assignment.userId && item.roleId === assignment.roleId)) {
          state.assignments.push(assignment);
        }
      }

      return { rows: [], rowCount: 1 };
    },
  };
  return { client: client as unknown as PoolClient, state };
}

test("site owner bootstrap accepts a normalized username and scrypt hash", () => {
  assert.deepEqual(
    getSiteOwnerBootstrapConfig({
      SITE_OWNER_USERNAME: " Site.Owner ",
      SITE_OWNER_PASSWORD_HASH: VALID_HASH,
    }),
    {
      username: "site.owner",
      passwordHash: VALID_HASH,
    },
  );
});

test("site owner bootstrap is disabled when credentials are missing or malformed", () => {
  assert.equal(getSiteOwnerBootstrapConfig({}), null);
  assert.equal(
    getSiteOwnerBootstrapConfig({
      SITE_OWNER_USERNAME: "ab",
      SITE_OWNER_PASSWORD_HASH: VALID_HASH,
    }),
    null,
  );
  assert.equal(
    getSiteOwnerBootstrapConfig({
      SITE_OWNER_USERNAME: "site.owner",
      SITE_OWNER_PASSWORD_HASH: "plaintext",
    }),
    null,
  );
  assert.equal(
    getSiteOwnerBootstrapConfig({
      SITE_OWNER_USERNAME: "site owner",
      SITE_OWNER_PASSWORD_HASH: VALID_HASH,
    }),
    null,
  );
});

test("site owner username comparison is case-insensitive and trims whitespace", () => {
  const config = {
    username: "site.owner",
    passwordHash: VALID_HASH,
  };

  assert.equal(isSiteOwnerUsername(" SITE.OWNER ", config.username), true);
  assert.equal(isSiteOwnerUsername("another-user", config.username), false);
  assert.equal(isSiteOwnerUsername("site.owner", null), false);
});

test("configured site-owner username remains reserved when the password hash is invalid", () => {
  const environment = {
    SITE_OWNER_USERNAME: " Site.Owner ",
    SITE_OWNER_PASSWORD_HASH: "invalid",
  };

  assert.equal(getSiteOwnerBootstrapConfig(environment), null);
  assert.equal(getConfiguredSiteOwnerUsername(environment), "site.owner");
  assert.equal(isSiteOwnerUsername("SITE.OWNER", getConfiguredSiteOwnerUsername(environment)), true);
});

test("site owner receives application permissions but not hosting-owner portal permissions", () => {
  assert.deepEqual(
    getSiteOwnerPermissionKeys({
      "admin_users": ["read", "all"],
      "hosting_owner.portal": ["read"],
    }),
    ["admin_users.read", "admin_users.all"],
  );
});

test("site owner role name is reserved from administrator-created roles", () => {
  assert.equal(isReservedOwnerRoleName("__site_owner__"), true);
});

test("public member registration rejects the configured site owner username", async (t) => {
  const previousUsername = process.env.SITE_OWNER_USERNAME;
  const previousHash = process.env.SITE_OWNER_PASSWORD_HASH;
  t.after(() => {
    if (previousUsername === undefined) delete process.env.SITE_OWNER_USERNAME;
    else process.env.SITE_OWNER_USERNAME = previousUsername;
    if (previousHash === undefined) delete process.env.SITE_OWNER_PASSWORD_HASH;
    else process.env.SITE_OWNER_PASSWORD_HASH = previousHash;
  });
  process.env.SITE_OWNER_USERNAME = "site.owner";
  process.env.SITE_OWNER_PASSWORD_HASH = VALID_HASH;

  const result = await registerMember({
    username: " SITE.OWNER ",
    password: "example-password",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "USERNAME_RESERVED");
});

test("guest sessions cannot claim the configured site-owner username", async (t) => {
  const previousUsername = process.env.SITE_OWNER_USERNAME;
  const previousHash = process.env.SITE_OWNER_PASSWORD_HASH;
  t.after(() => {
    if (previousUsername === undefined) delete process.env.SITE_OWNER_USERNAME;
    else process.env.SITE_OWNER_USERNAME = previousUsername;
    if (previousHash === undefined) delete process.env.SITE_OWNER_PASSWORD_HASH;
    else process.env.SITE_OWNER_PASSWORD_HASH = previousHash;
  });
  process.env.SITE_OWNER_USERNAME = "site.owner";
  process.env.SITE_OWNER_PASSWORD_HASH = VALID_HASH;

  await assert.rejects(
    createGuestSession(" SITE.OWNER "),
    (error: Error & { code?: string }) => error.code === "USERNAME_RESERVED",
  );
});

test("site owner bootstrap creates one linked member with application grants", async () => {
  const { client, state } = createBootstrapClient();
  const permissionKeys = ["admin_users.read", "admin_users.all"];

  await provisionSiteOwner(client, SITE_OWNER_CONFIG, permissionKeys);

  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].username, SITE_OWNER_CONFIG.username);
  assert.equal(state.users[0].passwordHash, VALID_HASH);
  assert.equal(state.roles.length, 1);
  assert.equal(state.roles[0].isOwner, false);
  assert.equal(state.assignments.length, 1);
  assert.equal(state.profiles.length, 1);
  assert.deepEqual(state.permissions.map(({ key }) => key).sort(), permissionKeys.sort());
});

test("site owner bootstrap is idempotent and preserves the configured password hash", async () => {
  const { client, state } = createBootstrapClient();

  await provisionSiteOwner(client, SITE_OWNER_CONFIG, ["admin_users.read", "hosting_owner.portal"]);
  await provisionSiteOwner(client, {
    ...SITE_OWNER_CONFIG,
    passwordHash: `${"c".repeat(32)}:${"d".repeat(128)}`,
  }, ["admin_users.read", "admin_roles.read"]);

  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].passwordHash, VALID_HASH);
  assert.equal(state.roles.length, 1);
  assert.equal(state.assignments.length, 1);
  assert.equal(state.profiles.length, 1);
  assert.deepEqual(
    state.permissions.map(({ key }) => key).sort(),
    ["admin_roles.read", "admin_users.read"],
  );
});

test("site owner bootstrap rolls back when profile creation fails", async () => {
  const { client, state } = createBootstrapClient({}, true);

  await assert.rejects(
    provisionSiteOwner(client, SITE_OWNER_CONFIG, ["admin_users.read"]),
    /profile write failed/,
  );

  assert.equal(state.users.length, 0);
  assert.equal(state.roles.length, 0);
  assert.equal(state.assignments.length, 0);
  assert.equal(state.profiles.length, 0);
  assert.equal(state.permissions.length, 0);
});

test("site owner bootstrap refuses to promote a username collision", async () => {
  const { client, state } = createBootstrapClient({
    users: [{ id: "unrelated-user", username: "site.owner", passwordHash: "existing-hash" }],
  });

  await assert.rejects(
    provisionSiteOwner(client, SITE_OWNER_CONFIG, ["admin_users.read"]),
    (error: Error & { code?: string }) => error.code === "SITE_OWNER_USERNAME_CONFLICT",
  );

  assert.equal(state.users.length, 1);
  assert.equal(state.users[0].id, "unrelated-user");
  assert.equal(state.roles.length, 0);
  assert.equal(state.assignments.length, 0);
});

test("site owner bootstrap refuses an unrelated role using the reserved role name", async () => {
  const { client, state } = createBootstrapClient({
    roles: [{
      id: "00000000-0000-4000-8000-000000000001",
      name: "__site_owner__",
      managedBy: "administrator",
      isOwner: false,
    }],
  });

  await assert.rejects(
    provisionSiteOwner(client, SITE_OWNER_CONFIG, ["admin_users.read"]),
    (error: Error & { code?: string }) => error.code === "SITE_OWNER_ROLE_CONFLICT",
  );

  assert.equal(state.users.length, 0);
  assert.equal(state.roles.length, 1);
  assert.equal(state.assignments.length, 0);
});
