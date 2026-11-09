import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import { test } from "node:test";
import {
  authenticateAgent,
  hashAgentPassword,
  provisionWalletAgent,
  verifyAgentPassword,
} from "../server/services/agentAuthService";
import type { AgentAuthPersistence, ProvisionWalletAgentPersistence } from "../server/services/agentAuthService";
import { verifyAuthToken } from "../server/services/authService";

test("agent password hashes verify without accepting malformed hashes", () => {
  const hash = hashAgentPassword("temporary-agent-password");

  assert.equal(verifyAgentPassword("temporary-agent-password", hash), true);
  assert.equal(verifyAgentPassword("wrong-password", hash), false);
  assert.equal(verifyAgentPassword("anything", "not-a-valid-hash"), false);
});

test("active agents receive signed, role-scoped sessions", async () => {
  const salt = randomUUID().replaceAll("-", "");
  const hash = `${salt}:${scryptSync("agent-password", salt, 64).toString("hex")}`;
  const persistence: AgentAuthPersistence = {
    findAgentByUsername: async () => ({
      id: "agent-7",
      username: "agent-seven",
      name: "Agent Seven",
      phone: "+967777123456",
      passwordHash: hash,
      status: "active",
      forcePasswordChange: false,
    }),
    updateAgentPassword: async () => {},
  };

  const result = await authenticateAgent("AGENT-SEVEN", "agent-password", persistence);
  const claims = verifyAuthToken(result.token);

  assert.deepEqual(result.agent, {
    id: "agent-7",
    username: "agent-seven",
    name: "Agent Seven",
    phone: "+967777123456",
    forcePasswordChange: false,
  });
  assert.equal(claims?.sub, "agent-7");
  assert.equal(claims?.role, "agent");
  assert.equal(claims?.type, "wallet_agent");
});

test("inactive agents and invalid credentials receive the same authentication failure", async () => {
  const persistence: AgentAuthPersistence = {
    findAgentByUsername: async () => ({
      id: "agent-8",
      username: "agent-eight",
      name: "Agent Eight",
      phone: "",
      passwordHash: hashAgentPassword("correct-password"),
      status: "disabled",
      forcePasswordChange: false,
    }),
    updateAgentPassword: async () => {},
  };

  await assert.rejects(authenticateAgent("agent-eight", "correct-password", persistence), {
    code: "INVALID_AGENT_CREDENTIALS",
  });
  await assert.rejects(authenticateAgent("agent-eight", "wrong-password", persistence), {
    code: "INVALID_AGENT_CREDENTIALS",
  });
});

test("admin provisioning returns a one-time password and commits only after audit", async () => {
  const statements: string[] = [];
  let storedPasswordHash = "";
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push(text);
      if (text.includes('INSERT INTO "wallet_agents"')) storedPasswordHash = String(values?.[3]);
      return text.includes("RETURNING")
        ? { rows: [{ id: "agent-9" }] }
        : { rows: [] };
    },
    release() {},
  };
  let auditedUsername = "";
  const persistence: ProvisionWalletAgentPersistence = {
    connect: async () => client as unknown as import("pg").PoolClient,
    logAudit: async (params) => {
      auditedUsername = String(params.metadata?.username);
    },
  };

  const agent = await provisionWalletAgent(
    { username: "New.Agent", name: "New Agent", phone: "+967 777 123 456" },
    "admin-1",
    persistence,
  );

  assert.equal(agent.username, "new.agent");
  assert.equal(agent.id, "agent-9");
  assert.equal(agent.phone, "+967777123456");
  assert.equal(verifyAgentPassword(agent.temporaryPassword, storedPasswordHash), true);
  assert.ok(statements.some((statement) => statement.includes('"phone"')));
  assert.equal(auditedUsername, "new.agent");
  assert.equal(statements.at(-1), "COMMIT");
});

test("agent provisioning requires an international phone number when provided", async () => {
  let connected = false;
  const persistence: ProvisionWalletAgentPersistence = {
    connect: async () => {
      connected = true;
      throw new Error("database should not be reached");
    },
    logAudit: async () => {},
  };

  await assert.rejects(
    provisionWalletAgent(
      { username: "new.agent", name: "New Agent", phone: "0777123456" },
      "admin-1",
      persistence,
    ),
    { code: "INVALID_AGENT_PHONE" },
  );
  assert.equal(connected, false);
});

test("agent provisioning rolls back when the audit record cannot be written", async () => {
  const statements: string[] = [];
  const client = {
    async query(text: string) {
      statements.push(text);
      return text.includes("RETURNING") ? { rows: [{ id: "agent-10" }] } : { rows: [] };
    },
    release() {},
  };
  const persistence: ProvisionWalletAgentPersistence = {
    connect: async () => client as unknown as import("pg").PoolClient,
    logAudit: async () => {
      throw new Error("audit unavailable");
    },
  };

  await assert.rejects(
    provisionWalletAgent({ username: "new.agent", name: "New Agent" }, "admin-1", persistence),
    /audit unavailable/,
  );
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.includes("COMMIT"), false);
});
