import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentPackageError,
  saveAgentPackage,
  setAgentPackageActive,
  type AgentPackagePersistence,
} from "../server/services/agentPackageService";

const agentId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";

function createPersistence(options: { rowCount?: number; fail?: boolean } = {}) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const persistence: AgentPackagePersistence = {
    query: async (text, values = []) => {
      statements.push({ text, values });
      if (options.fail) throw new Error("database failure");
      if (text.includes("RETURNING")) {
        return {
          rows: options.rowCount === 0 ? [] : [{
            id: packageId,
            agent_id: agentId,
            coin_amount: String(values[1]),
            price_minor_units: String(values[2]),
            currency_code: values[3],
            payment_instructions: values[4],
            is_active: true,
          }],
          rowCount: options.rowCount ?? 1,
        };
      }
      return { rows: [], rowCount: options.rowCount ?? 1 };
    },
  };
  return { persistence, statements };
}

test("agent package rejects unsafe quantities and fiat prices before database access", async () => {
  let connected = false;
  const persistence: AgentPackagePersistence = {
    query: async () => {
      connected = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.rejects(
    saveAgentPackage({
      agentId,
      coinAmount: 0,
      priceMinorUnits: 2000,
      currencyCode: "YER",
      paymentInstructions: "Transfer details",
    }, persistence),
    (error: unknown) => error instanceof AgentPackageError && error.code === "INVALID_AGENT_PACKAGE",
  );
  assert.equal(connected, false);
});

test("agent package updates are scoped to one owner and preserve integer terms", async () => {
  const fake = createPersistence();

  const result = await saveAgentPackage({
    agentId,
    coinAmount: 1000,
    priceMinorUnits: 25000,
    currencyCode: "YER",
    paymentInstructions: "تحويل على الحساب المعتمد",
  }, fake.persistence);

  assert.equal(result.id, packageId);
  assert.match(fake.statements[0].text, /ON CONFLICT \("agent_id", "coin_amount"\)/);
  assert.deepEqual(fake.statements[0].values, [
    agentId,
    "1000",
    "25000",
    "YER",
    "تحويل على الحساب المعتمد",
  ]);
});

test("agent can deactivate only a package belonging to their account", async () => {
  const fake = createPersistence({ rowCount: 0 });

  await assert.rejects(
    setAgentPackageActive(agentId, packageId, false, fake.persistence),
    (error: unknown) => error instanceof AgentPackageError && error.code === "AGENT_PACKAGE_NOT_FOUND",
  );
  assert.match(fake.statements[0].text, /WHERE "id" = \$1 AND "agent_id" = \$2/);
  assert.deepEqual(fake.statements[0].values, [packageId, agentId, false]);
});
