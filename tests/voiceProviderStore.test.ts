import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptVoiceProviderSecret,
  encryptVoiceProviderSecret,
} from "../server/services/voiceProviderEncryption";
import {
  createVoiceProviderStore,
  type VoiceProviderQueryExecutor,
  type VoiceProviderQueryResult,
} from "../server/services/voiceProviderStore";

const VALID_KEY = Buffer.alloc(32, 0x31).toString("base64");

const withEncryptionKey = async <T>(
  key: string | undefined,
  callback: () => T | Promise<T>,
): Promise<T> => {
  const previousKey = process.env.VOICE_PROVIDER_ENCRYPTION_KEY;
  if (key === undefined) {
    delete process.env.VOICE_PROVIDER_ENCRYPTION_KEY;
  } else {
    process.env.VOICE_PROVIDER_ENCRYPTION_KEY = key;
  }

  try {
    return await callback();
  } finally {
    if (previousKey === undefined) {
      delete process.env.VOICE_PROVIDER_ENCRYPTION_KEY;
    } else {
      process.env.VOICE_PROVIDER_ENCRYPTION_KEY = previousKey;
    }
  }
};

const publicAccountRow = {
  id: "account-1",
  name: "Primary LiveKit",
  url: "wss://voice.example.com",
  has_api_key: true,
  has_api_secret: true,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-01T00:00:00.000Z"),
};

const makeDatabase = (
  query: (
    sql: string,
    values?: unknown[],
  ) => VoiceProviderQueryResult | Promise<VoiceProviderQueryResult>,
): VoiceProviderQueryExecutor => ({
  query: async (sql, values) => query(sql, values),
});

test("voice provider listing returns public account metadata only", async () => {
  const store = createVoiceProviderStore(
    makeDatabase(async () => ({ rows: [publicAccountRow], rowCount: 1 })),
  );

  const accounts = await store.listAccounts();

  assert.deepStrictEqual(accounts, [{
    id: "account-1",
    name: "Primary LiveKit",
    url: "wss://voice.example.com",
    hasApiKey: true,
    hasApiSecret: true,
    createdAt: publicAccountRow.created_at.toISOString(),
    updatedAt: publicAccountRow.updated_at.toISOString(),
  }]);
  assert.equal("apiKey" in accounts[0], false);
  assert.equal("apiSecret" in accounts[0], false);
});

test("creating a voice provider account stores encrypted credentials and returns no secrets", async () => {
  await withEncryptionKey(VALID_KEY, async () => {
    let insertedValues: unknown[] | undefined;
    const store = createVoiceProviderStore(
      makeDatabase(async (_sql, values) => {
        insertedValues = values;
        return { rows: [publicAccountRow], rowCount: 1 };
      }),
    );

    const account = await store.createAccount({
      id: "account-1",
      name: "Primary LiveKit",
      url: "wss://voice.example.com",
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    });

    assert.ok(insertedValues);
    const encryptedApiKey = JSON.parse(String(insertedValues[3])) as unknown;
    const encryptedApiSecret = JSON.parse(String(insertedValues[4])) as unknown;
    assert.equal(decryptVoiceProviderSecret(encryptedApiKey), "livekit-api-key");
    assert.equal(decryptVoiceProviderSecret(encryptedApiSecret), "livekit-api-secret");
    assert.equal("apiKey" in account, false);
    assert.equal("apiSecret" in account, false);
  });
});

test("updating account metadata without new credentials preserves the encrypted values", async () => {
  let updateValues: unknown[] | undefined;
  const store = createVoiceProviderStore(
    makeDatabase(async (_sql, values) => {
      updateValues = values;
      return { rows: [publicAccountRow], rowCount: 1 };
    }),
  );

  const account = await store.updateAccount("account-1", {
    name: "Renamed LiveKit",
    url: "wss://voice.example.com",
  });

  assert.ok(updateValues);
  assert.equal(updateValues[3], null);
  assert.equal(updateValues[4], null);
  assert.equal(account?.hasApiKey, true);
  assert.equal(account?.hasApiSecret, true);
});

test("reading credentials decrypts them only for trusted server-side callers", async () => {
  await withEncryptionKey(VALID_KEY, async () => {
    const apiKey = encryptVoiceProviderSecret("livekit-api-key");
    const apiSecret = encryptVoiceProviderSecret("livekit-api-secret");
    const store = createVoiceProviderStore(
      makeDatabase(async () => ({
        rows: [{
          api_key_encrypted: apiKey,
          api_secret_encrypted: apiSecret,
        }],
        rowCount: 1,
      })),
    );

    assert.deepStrictEqual(await store.getCredentials("account-1"), {
      apiKey: "livekit-api-key",
      apiSecret: "livekit-api-secret",
    });
  });
});

test("selecting a LiveKit account with unreadable credentials does not persist the selection", async () => {
  let selectionWriteAttempted = false;
  const store = createVoiceProviderStore(
    makeDatabase(async (sql) => {
      if (sql.includes("voice_provider_accounts")) {
        return {
          rows: [{
            api_key_encrypted: { version: 1, iv: "invalid", ciphertext: "invalid", authTag: "invalid" },
            api_secret_encrypted: { version: 1, iv: "invalid", ciphertext: "invalid", authTag: "invalid" },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("voice_provider_selection")) {
        selectionWriteAttempted = true;
      }
      return { rows: [], rowCount: 0 };
    }),
  );

  await withEncryptionKey(VALID_KEY, async () => {
    await assert.rejects(
      store.setRequestedSelection({ provider: "livekit", accountId: "account-1" }),
      /invalid encrypted voice provider secret/i,
    );
  });

  assert.equal(selectionWriteAttempted, false);
});

test("missing provider selection safely defaults to WebRTC", async () => {
  const executor = makeDatabase(async () => ({ rows: [], rowCount: 0 }));
  const store = createVoiceProviderStore(executor);

  assert.deepStrictEqual(await store.getRequestedSelection(), {
    provider: "webrtc",
    accountId: null,
  });
});
