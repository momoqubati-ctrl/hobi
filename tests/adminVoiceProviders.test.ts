import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { H3 } from "h3";
import {
  createVoiceProviderAdminHandlers,
  createVoiceProviderAdminAuthorizer,
  type VoiceProviderAdminAuditInput,
  type VoiceProviderAdminAuthorizer,
  type VoiceProviderAdminStore,
  type VoiceProviderAdminTransactionRunner,
} from "../server/services/voiceProviderAdminApi";
import {
  VoiceProviderEncryptionConfigurationError,
  VoiceProviderSecretDecryptionError,
} from "../server/services/voiceProviderEncryption";
import type {
  PublicVoiceProviderAccount,
  RequestedVoiceProviderSelection,
} from "../server/services/voiceProviderStore";
import {
  VoiceProviderAccountNotFoundError,
  VoiceProviderCredentialsRequiredError,
} from "../server/services/voiceProviderStore";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

const publicAccount: PublicVoiceProviderAccount = {
  id: ACCOUNT_ID,
  name: "Primary LiveKit",
  url: "wss://voice.example.com",
  hasApiKey: true,
  hasApiSecret: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const selection: RequestedVoiceProviderSelection = {
  provider: "webrtc",
  accountId: null,
};

function signAdminToken(role: string, username = "admin"): string {
  const payload = Buffer.from(JSON.stringify({
    sub: "admin-1",
    username,
    role,
    exp: Date.now() + 60_000,
  })).toString("base64url");
  const secret = process.env.AUTH_SECRET || "dev-only-change-this-secret";
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

interface HarnessOptions {
  authorize?: VoiceProviderAdminAuthorizer;
  created?: boolean;
  deleteError?: Error;
  deleteResult?: boolean;
  putError?: Error;
  requestedSelection?: RequestedVoiceProviderSelection;
  selectionError?: Error;
}

function createHarness(options: HarnessOptions = {}) {
  const permissionCalls: string[] = [];
  const audits: VoiceProviderAdminAuditInput[] = [];
  const writes: Array<{ id: string; input: { name: string; url: string; apiKey?: string; apiSecret?: string } }> = [];
  const selectionWrites: RequestedVoiceProviderSelection[] = [];
  const store: VoiceProviderAdminStore = {
    async listAccounts() {
      return [publicAccount];
    },
    async getRequestedSelection() {
      return options.requestedSelection ?? selection;
    },
    async setRequestedSelection(input) {
      if (options.selectionError) throw options.selectionError;
      selectionWrites.push(input);
      return input;
    },
    async putAccount(id, input) {
      writes.push({ id, input });
      if (options.putError) throw options.putError;
      return { account: publicAccount, created: options.created ?? writes.length === 1 };
    },
    async deleteAccount() {
      if (options.deleteError) throw options.deleteError;
      return options.deleteResult ?? true;
    },
  };
  const authorize = options.authorize ?? (async (_event, permission) => {
    permissionCalls.push(permission);
    return { ok: true as const, userId: "admin-1" };
  });
  const runTransaction: VoiceProviderAdminTransactionRunner = async (operation) =>
    operation({
      store,
      audit: async (entry) => {
        audits.push(entry);
      },
    });
  const handlers = createVoiceProviderAdminHandlers({
    authorize,
    runTransaction,
  });
  const app = new H3();
  app.get("/api/admin/voice-providers", handlers.get);
  app.put("/api/admin/voice-providers/:id", handlers.put);
  app.delete("/api/admin/voice-providers/:id", handlers.delete);
  app.put("/api/admin/voice-provider-selection", handlers.putSelection);

  return { app, permissionCalls, audits, writes, selectionWrites };
}

test("voice provider listing requires admin read permission and never returns secrets", async () => {
  const { app, permissionCalls } = createHarness();
  const response = await app.request("/api/admin/voice-providers");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepStrictEqual(permissionCalls, ["admin_micprovidercp.read"]);
  assert.match(body, /hasApiKey/);
  assert.doesNotMatch(body, /apiKey|apiSecret|ciphertext|authTag/);
});

test("voice provider API returns 401 for a missing admin session", async () => {
  const { app } = createHarness({ authorize: createVoiceProviderAdminAuthorizer() });
  const response = await app.request("/api/admin/voice-providers");
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.code, "UNAUTHENTICATED");
});

test("voice provider API returns 403 when an authenticated admin lacks the requested permission", async () => {
  const { app } = createHarness({
    authorize: createVoiceProviderAdminAuthorizer(async () => false),
  });
  const response = await app.request("/api/admin/voice-providers", {
    headers: { authorization: `Bearer ${signAdminToken("admin")}` },
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "FORBIDDEN");
});

test("voice provider authorizer lets the owner proceed without querying granular permissions", async () => {
  let permissionChecks = 0;
  const { app } = createHarness({
    authorize: createVoiceProviderAdminAuthorizer(async () => {
      permissionChecks += 1;
      return false;
    }),
  });
  const response = await app.request("/api/admin/voice-providers", {
    headers: { authorization: `Bearer ${signAdminToken("owner", "Safarihost")}` },
  });

  assert.equal(response.status, 200);
  assert.equal(permissionChecks, 0);
});

test("voice provider authorizer does not trust an owner claim from another account", async () => {
  let permissionChecks = 0;
  const { app } = createHarness({
    authorize: createVoiceProviderAdminAuthorizer(async () => {
      permissionChecks += 1;
      return false;
    }),
  });
  const response = await app.request("/api/admin/voice-providers", {
    headers: { authorization: `Bearer ${signAdminToken("owner", "another-user")}` },
  });

  assert.equal(response.status, 403);
  assert.equal(permissionChecks, 1);
});

test("voice provider PUT creates an account without returning or auditing credentials", async () => {
  const { app, permissionCalls, audits, writes } = createHarness();
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Primary LiveKit",
      url: "wss://voice.example.com",
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    }),
  });
  const body = await response.text();

  assert.equal(response.status, 201);
  assert.deepStrictEqual(permissionCalls, ["micprovideredit.edit"]);
  assert.equal(writes.length, 1);
  assert.deepStrictEqual(audits.map(({ action }) => action), ["voice_provider.create"]);
  assert.doesNotMatch(JSON.stringify(audits), /livekit-api-key|livekit-api-secret/);
  assert.doesNotMatch(body, /livekit-api-key|livekit-api-secret|ciphertext|authTag/);
});

test("voice provider PUT rejects an invalid account identifier before writing", async () => {
  const { app, writes } = createHarness();
  const response = await app.request("/api/admin/voice-providers/not-a-uuid", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Primary LiveKit",
      url: "wss://voice.example.com",
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(writes.length, 0);
});

test("voice provider PUT preserves omitted credentials when updating an account", async () => {
  const { app, audits, writes } = createHarness({ created: false });
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Renamed LiveKit",
      url: "wss://voice.example.com",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepStrictEqual(writes[0].input, {
    name: "Renamed LiveKit",
    url: "wss://voice.example.com",
  });
  assert.equal(audits[0].metadata?.credentialsUpdated, false);
});

test("voice provider PUT requires both credentials when the account does not exist", async () => {
  const { app, audits } = createHarness({
    putError: new VoiceProviderCredentialsRequiredError(),
  });
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Primary LiveKit",
      url: "wss://voice.example.com",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(audits.length, 0);
});

test("voice provider PUT reports missing encryption configuration without exposing secret values", async () => {
  const { app } = createHarness({ putError: new VoiceProviderEncryptionConfigurationError() });
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Primary LiveKit",
      url: "wss://voice.example.com",
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "ENCRYPTION_UNAVAILABLE");
  assert.match(body.message, /VOICE_PROVIDER_ENCRYPTION_KEY/);
  assert.doesNotMatch(JSON.stringify(body), /livekit-api-key|livekit-api-secret/);
});

test("voice provider PUT rejects invalid URLs before writing", async () => {
  const { app, writes } = createHarness();
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Primary LiveKit",
      url: "http://voice.example.com",
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(writes.length, 0);
});

test("voice provider PUT rejects unexpected URL paths", async () => {
  const { app, writes } = createHarness();
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Primary LiveKit",
      url: "wss://voice.example.com/livekit",
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(writes.length, 0);
});

test("voice provider DELETE requires delete permission and returns 404 for an unknown account", async () => {
  const { app, permissionCalls, audits } = createHarness({ deleteResult: false });
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "DELETE",
  });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, "NOT_FOUND");
  assert.deepStrictEqual(permissionCalls, ["micprovideredit.delete"]);
  assert.equal(audits.length, 0);
});

test("voice provider DELETE audits successful removal without credential metadata", async () => {
  const { app, audits } = createHarness();
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "DELETE",
  });

  assert.equal(response.status, 200);
  assert.deepStrictEqual(audits.map(({ action }) => action), ["voice_provider.delete"]);
  assert.deepStrictEqual(audits[0].metadata, {});
});

test("voice provider DELETE reports a conflict when the selected account is protected by the foreign key", async () => {
  const error = Object.assign(new Error("foreign key conflict"), { code: "23503" });
  const { app, audits } = createHarness({ deleteError: error });
  const response = await app.request(`/api/admin/voice-providers/${ACCOUNT_ID}`, {
    method: "DELETE",
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "CONFLICT");
  assert.equal(audits.length, 0);
  assert.doesNotMatch(JSON.stringify(body), /foreign key conflict/);
});

test("voice provider selection can switch to a LiveKit account and audits the change", async () => {
  const { app, permissionCalls, audits, selectionWrites } = createHarness();
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "livekit", accountId: ACCOUNT_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepStrictEqual(permissionCalls, ["micprovideredit.edit"]);
  assert.deepStrictEqual(selectionWrites, [{ provider: "livekit", accountId: ACCOUNT_ID }]);
  assert.deepStrictEqual(body.selection, { provider: "livekit", accountId: ACCOUNT_ID });
  assert.deepStrictEqual(audits.map(({ action }) => action), ["voice_provider.selection.update"]);
  assert.deepStrictEqual(audits[0].metadata, { provider: "livekit", accountId: ACCOUNT_ID });
});

test("voice provider selection can return to WebRTC and audits the change", async () => {
  const { app, audits, selectionWrites } = createHarness({
    requestedSelection: { provider: "livekit", accountId: ACCOUNT_ID },
  });
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "webrtc" }),
  });

  assert.equal(response.status, 200);
  assert.deepStrictEqual(selectionWrites, [{ provider: "webrtc", accountId: null }]);
  assert.deepStrictEqual(audits.map(({ action }) => action), ["voice_provider.selection.update"]);
  assert.deepStrictEqual(audits[0].metadata, { provider: "webrtc", accountId: null });
});

test("voice provider selection requires an existing LiveKit account", async () => {
  const { app, audits, selectionWrites } = createHarness({
    selectionError: new VoiceProviderAccountNotFoundError(),
  });
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "livekit", accountId: ACCOUNT_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, "NOT_FOUND");
  assert.equal(selectionWrites.length, 0);
  assert.equal(audits.length, 0);
});

test("voice provider selection rejects malformed input before writing", async () => {
  const { app, audits, selectionWrites } = createHarness();
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "livekit", accountId: "not-a-uuid" }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.equal(selectionWrites.length, 0);
  assert.equal(audits.length, 0);
});

test("voice provider selection does not audit an idempotent update", async () => {
  const { app, audits } = createHarness({
    requestedSelection: { provider: "livekit", accountId: ACCOUNT_ID },
  });
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "livekit", accountId: ACCOUNT_ID }),
  });

  assert.equal(response.status, 200);
  assert.equal(audits.length, 0);
});

test("voice provider selection reports unavailable encryption without saving", async () => {
  const { app, audits } = createHarness({
    selectionError: new VoiceProviderEncryptionConfigurationError(),
  });
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "livekit", accountId: ACCOUNT_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, "ENCRYPTION_UNAVAILABLE");
  assert.equal(audits.length, 0);
});

test("voice provider selection reports unreadable credentials without saving", async () => {
  const { app, audits } = createHarness({
    selectionError: new VoiceProviderSecretDecryptionError(),
  });
  const response = await app.request("/api/admin/voice-provider-selection", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "livekit", accountId: ACCOUNT_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "PROVIDER_CREDENTIALS_INVALID");
  assert.equal(audits.length, 0);
  assert.doesNotMatch(JSON.stringify(body), /ciphertext|authTag|could not be decrypted/);
});
