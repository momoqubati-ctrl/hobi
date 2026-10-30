import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptVoiceProviderSecret,
  encryptVoiceProviderSecret,
} from "../server/services/voiceProviderEncryption";

const VALID_KEY = Buffer.alloc(32, 0x56).toString("base64");
const WRONG_KEY = Buffer.alloc(32, 0x77).toString("base64");

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

test("voice provider secrets are encrypted and can be decrypted with the configured key", async () => {
  await withEncryptionKey(VALID_KEY, () => {
    const secret = "livekit-api-secret-value";
    const encrypted = encryptVoiceProviderSecret(secret);

    assert.equal(encrypted.version, 1);
    assert.notEqual(encrypted.ciphertext, Buffer.from(secret).toString("base64"));
    assert.equal(decryptVoiceProviderSecret(encrypted), secret);
  });
});

test("voice provider encryption rejects a missing key", async () => {
  await withEncryptionKey(undefined, () => {
    assert.throws(
      () => encryptVoiceProviderSecret("livekit-api-secret-value"),
      /VOICE_PROVIDER_ENCRYPTION_KEY/,
    );
  });
});

test("voice provider encryption rejects malformed or incorrectly sized keys", async () => {
  await withEncryptionKey("not-base64!", () => {
    assert.throws(
      () => encryptVoiceProviderSecret("livekit-api-secret-value"),
      /VOICE_PROVIDER_ENCRYPTION_KEY/,
    );
  });

  await withEncryptionKey(Buffer.from("too-short").toString("base64"), () => {
    assert.throws(
      () => encryptVoiceProviderSecret("livekit-api-secret-value"),
      /VOICE_PROVIDER_ENCRYPTION_KEY/,
    );
  });
});

test("voice provider encryption rejects an empty secret", async () => {
  await withEncryptionKey(VALID_KEY, () => {
    assert.throws(
      () => encryptVoiceProviderSecret(""),
      /secret/i,
    );
  });
});

test("voice provider decryption rejects tampered data and a different key", async () => {
  const encrypted = await withEncryptionKey(VALID_KEY, () =>
    encryptVoiceProviderSecret("livekit-api-secret-value"),
  );

  await withEncryptionKey(VALID_KEY, () => {
    const tamperedTag = Buffer.from(encrypted.authTag, "base64");
    tamperedTag[0] ^= 0xff;
    const tampered = {
      ...encrypted,
      authTag: tamperedTag.toString("base64"),
    };

    assert.throws(
      () => decryptVoiceProviderSecret(tampered),
      /could not be decrypted/i,
    );
  });

  await withEncryptionKey(WRONG_KEY, () => {
    assert.throws(
      () => decryptVoiceProviderSecret(encrypted),
      /could not be decrypted/i,
    );
  });
});

test("voice provider decryption rejects malformed envelopes without exposing their contents", async () => {
  await withEncryptionKey(VALID_KEY, () => {
    const secret = "do-not-leak-this-secret";
    assert.throws(
      () => decryptVoiceProviderSecret({
        version: 2,
        iv: "invalid",
        ciphertext: secret,
        authTag: secret,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /invalid encrypted voice provider secret/i);
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  });
});
