import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  parseAnnouncementDailyLimits,
  persistAnnouncementRolePolicy,
} from "../server/services/announcementRolePolicy";

const roleId = "11111111-1111-4111-8111-111111111111";

test("announcement daily limits accept zero and the configured maximum", () => {
  assert.deepEqual(
    parseAnnouncementDailyLimits({ [roleId]: 0 }, [roleId]),
    { success: true, values: { [roleId]: 0 } },
  );
  assert.deepEqual(
    parseAnnouncementDailyLimits({ [roleId]: 1000 }, [roleId]),
    { success: true, values: { [roleId]: 1000 } },
  );
});

test("announcement daily limits reject non-integers and out-of-range values", () => {
  for (const invalidLimit of [-1, 1001, 1.5, "5", null]) {
    assert.equal(parseAnnouncementDailyLimits({ [roleId]: invalidLimit }, [roleId]).success, false);
  }
});

test("announcement daily limits reject invalid payloads and roles outside the submitted matrix", () => {
  assert.equal(parseAnnouncementDailyLimits(null, [roleId]).success, false);
  assert.equal(parseAnnouncementDailyLimits([], [roleId]).success, false);
  assert.equal(parseAnnouncementDailyLimits({ "not-a-role": 5 }, [roleId]).success, false);
  assert.equal(
    parseAnnouncementDailyLimits({ "22222222-2222-4222-8222-222222222222": 5 }, [roleId]).success,
    false,
  );
});

function createPolicyClient(options: {
  roles?: Array<{ id: string; is_owner: boolean; name: string }>;
  failOn?: string;
} = {}) {
  const statements: string[] = [];
  const client = {
    async query(statement: string) {
      statements.push(statement);
      if (options.failOn && statement.includes(options.failOn)) {
        throw new Error("simulated database failure");
      }
      if (statement.includes("SELECT id, is_owner, name FROM roles")) {
        return { rows: options.roles ?? [{ id: roleId, is_owner: false, name: "Regular" }], rowCount: 1 };
      }
      if (statement.includes("SELECT DISTINCT user_id")) {
        return { rows: [{ user_id: "member-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;

  return { client, statements };
}

test("role permission grants, daily limit, and audit commit in one transaction", async () => {
  const { client, statements } = createPolicyClient();

  const result = await persistAnnouncementRolePolicy(
    client,
    { [roleId]: { "announcement_all.use": true } },
    { [roleId]: 7 },
    "admin-1",
  );

  assert.deepEqual(result.affectedUsers, ["member-1"]);
  assert.equal(statements[0], "BEGIN");
  assert.ok(statements.some((statement) => statement.includes("INSERT INTO role_permissions")));
  assert.ok(statements.some((statement) => statement.includes("UPDATE roles SET announcement_daily_limit")));
  assert.ok(statements.some((statement) => statement.includes("INSERT INTO admin_audit_logs")));
  assert.equal(statements.at(-1), "COMMIT");
});

test("role permission updates cannot modify owner roles", async () => {
  const { client, statements } = createPolicyClient({
    roles: [{ id: roleId, is_owner: true, name: "Owner" }],
  });

  await assert.rejects(
    persistAnnouncementRolePolicy(client, { [roleId]: {} }, { [roleId]: 7 }, "admin-1"),
    { code: "ROLE_OWNER_PROTECTED" },
  );

  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});

test("role permission updates cannot modify the site-owner role", async () => {
  const { client, statements } = createPolicyClient({
    roles: [{ id: roleId, is_owner: false, name: "__site_owner__" }],
  });

  await assert.rejects(
    persistAnnouncementRolePolicy(client, { [roleId]: {} }, { [roleId]: 7 }, "admin-1"),
    { code: "ROLE_SITE_OWNER_PROTECTED" },
  );

  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});

test("a policy persistence failure rolls back the complete update", async () => {
  const { client, statements } = createPolicyClient({
    failOn: "UPDATE roles SET announcement_daily_limit",
  });

  await assert.rejects(
    persistAnnouncementRolePolicy(
      client,
      { [roleId]: { "announcement_all.use": true } },
      { [roleId]: 7 },
      "admin-1",
    ),
    /simulated database failure/,
  );

  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});
