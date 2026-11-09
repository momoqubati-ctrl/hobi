import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getExistingLifecycleRules,
  isPrivateReceiptPolicy,
} from "../server/services/privateReceiptStore";

test("missing bucket lifecycle configuration is treated as an empty rule set", async () => {
  const rules = await getExistingLifecycleRules(async () => {
    throw Object.assign(new Error("The lifecycle configuration does not exist"), {
      code: "NoSuchLifecycleConfiguration",
    });
  });

  assert.deepEqual(rules, []);
});

test("a single bucket lifecycle rule is normalized to a rule list", async () => {
  const lifecycle = {
    Rule: { ID: "existing-retention-rule" },
  };

  const rules = await getExistingLifecycleRules(async () => lifecycle);

  assert.deepEqual(rules, [{ ID: "existing-retention-rule" }]);
});

test("unexpected bucket lifecycle errors are not suppressed", async () => {
  const failure = Object.assign(new Error("access denied"), { code: "AccessDenied" });

  await assert.rejects(
    () => getExistingLifecycleRules(async () => { throw failure; }),
    (error) => error === failure,
  );
});

test("private receipt policy accepts private principals", () => {
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { AWS: ["arn:aws:iam::123456789012:root"] },
      Action: ["s3:GetObject"],
      Resource: ["arn:aws:s3:::hobi-private-receipts/*"],
    }],
  });

  assert.equal(isPrivateReceiptPolicy(policy), true);
});

test("private receipt policy rejects every public allow statement", () => {
  const policy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: ["arn:aws:s3:::hobi-private-receipts/*"],
    }],
  });

  assert.equal(isPrivateReceiptPolicy(policy), false);
});

test("private receipt policy rejects malformed documents", () => {
  assert.throws(() => isPrivateReceiptPolicy("{}"), /invalid access policy/);
  assert.throws(() => isPrivateReceiptPolicy("{"), /invalid access policy/);
});
