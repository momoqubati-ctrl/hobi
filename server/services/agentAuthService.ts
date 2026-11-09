import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";
import { issueAgentToken } from "./authService";
import { logAdminAudit } from "./adminPermissions";

const PASSWORD_HASH_PATTERN = /^([0-9a-f]{32}):([0-9a-f]{128})$/i;

export type WalletAgentRecord = {
  id: string;
  username: string;
  name: string;
  phone: string;
  passwordHash: string;
  status: string;
  forcePasswordChange: boolean;
};

export type AgentAuthPersistence = {
  findAgentByUsername(username: string): Promise<WalletAgentRecord | null>;
  findAgentById(id: string): Promise<WalletAgentRecord | null>;
  updateAgentPassword(id: string, passwordHash: string): Promise<void>;
};

export type ProvisionWalletAgentPersistence = {
  connect: () => Promise<PoolClient>;
  logAudit: typeof logAdminAudit;
};

export class AgentAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentAuthError";
  }
}

const defaultPersistence: AgentAuthPersistence = {
  async findAgentByUsername(username) {
    const result = await dbPool.query<WalletAgentRecord>(
      `SELECT "id"::text AS "id", "username", "name", "password_hash" AS "passwordHash",
              "phone",
              "status", "force_password_change" AS "forcePasswordChange"
       FROM "wallet_agents"
       WHERE lower("username") = lower($1)
       LIMIT 1`,
      [username],
    );
    return result.rows[0] ?? null;
  },
  async findAgentById(id) {
    const result = await dbPool.query<WalletAgentRecord>(
      `SELECT "id"::text AS "id", "username", "name", "password_hash" AS "passwordHash",
              "phone",
              "status", "force_password_change" AS "forcePasswordChange"
       FROM "wallet_agents"
       WHERE "id" = $1
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ?? null;
  },
  async updateAgentPassword(id, passwordHash) {
    await dbPool.query(
      `UPDATE "wallet_agents"
       SET "password_hash" = $1, "force_password_change" = false, "updated_at" = now()
       WHERE "id" = $2 AND "status" = 'active'`,
      [passwordHash, id],
    );
  },
};

export const hashAgentPassword = (password: string): string => {
  if (password.length < 12 || password.length > 256) {
    throw new AgentAuthError("INVALID_PASSWORD", "كلمة المرور يجب أن تكون 12 حرفًا على الأقل");
  }
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

export const verifyAgentPassword = (password: string, passwordHash: string): boolean => {
  const match = PASSWORD_HASH_PATTERN.exec(passwordHash);
  if (!match || password.length > 256) return false;

  const expected = Buffer.from(match[2], "hex");
  const actual = scryptSync(password, match[1], 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const authenticateAgent = async (
  username: string,
  password: string,
  persistence: AgentAuthPersistence = defaultPersistence,
) => {
  const normalizedUsername = username.trim();
  if (
    normalizedUsername.length < 3 ||
    normalizedUsername.length > 64 ||
    password.length === 0 ||
    password.length > 256
  ) {
    throw new AgentAuthError("INVALID_AGENT_CREDENTIALS", "بيانات الدخول غير صحيحة");
  }

  const agent = await persistence.findAgentByUsername(normalizedUsername);
  if (
    !agent ||
    agent.status !== "active" ||
    !verifyAgentPassword(password, agent.passwordHash)
  ) {
    throw new AgentAuthError("INVALID_AGENT_CREDENTIALS", "بيانات الدخول غير صحيحة");
  }

  return {
    token: issueAgentToken({ id: agent.id, username: agent.username }),
    agent: {
      id: agent.id,
      username: agent.username,
      name: agent.name,
      phone: agent.phone,
      forcePasswordChange: agent.forcePasswordChange,
    },
  };
};

export const changeAgentPassword = async (
  agentId: string,
  currentPassword: string,
  newPassword: string,
  persistence: AgentAuthPersistence = defaultPersistence,
): Promise<void> => {
  if (newPassword.length < 12 || newPassword.length > 256) {
    throw new AgentAuthError("INVALID_PASSWORD", "كلمة المرور يجب أن تكون 12 حرفًا على الأقل");
  }
  const agent = await persistence.findAgentById(agentId);
  if (!agent || agent.status !== "active" || !verifyAgentPassword(currentPassword, agent.passwordHash)) {
    throw new AgentAuthError("INVALID_AGENT_CREDENTIALS", "بيانات الدخول غير صحيحة");
  }
  if (currentPassword === newPassword) {
    throw new AgentAuthError("PASSWORD_UNCHANGED", "اختر كلمة مرور مختلفة عن الحالية");
  }
  await persistence.updateAgentPassword(agentId, hashAgentPassword(newPassword));
};

export const provisionWalletAgent = async (
  input: { username: string; name: string; phone?: string },
  actorId: string,
  persistence: ProvisionWalletAgentPersistence = {
    connect: () => dbPool.connect(),
    logAudit: logAdminAudit,
  },
) => {
  const username = input.username.trim().toLowerCase();
  const name = input.name.trim();
  const rawPhone = input.phone?.trim() ?? "";
  const phone = rawPhone.replace(/[\s().-]/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) || name.length < 1 || name.length > 120) {
    throw new AgentAuthError("INVALID_AGENT_INPUT", "اسم الوكيل أو اسم المستخدم غير صالح");
  }
  if (phone !== "" && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new AgentAuthError("INVALID_AGENT_PHONE", "أدخل رقم الهاتف بصيغة دولية مع مفتاح الدولة");
  }

  const temporaryPassword = randomBytes(24).toString("base64url");
  const client = await persistence.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query<{ id: string }>(
      `INSERT INTO "wallet_agents"
        ("username", "name", "phone", "password_hash", "status", "force_password_change")
       VALUES ($1, $2, $3, $4, 'active', true)
       RETURNING "id"::text AS "id"`,
      [username, name, phone, hashAgentPassword(temporaryPassword)],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("wallet agent account was not created");

    await persistence.logAudit(
      {
        actorId,
        action: "wallet_agent_created",
        targetType: "wallet_agent",
        targetId: id,
        metadata: { username },
      },
      { queryExecutor: client, throwOnError: true },
    );
    await client.query("COMMIT");
    transactionStarted = false;
    return { id, username, name, phone, temporaryPassword };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "wallet agent creation rollback failed");
      }
    }
    throw error;
  } finally {
    client.release();
  }
};
