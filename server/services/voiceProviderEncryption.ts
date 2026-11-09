import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ENVIRONMENT_VARIABLE = "VOICE_PROVIDER_ENCRYPTION_KEY";
const ENCRYPTION_VERSION = 1;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_KEY_BYTES = 32;

export class VoiceProviderEncryptionConfigurationError extends Error {
  constructor() {
    super(`${KEY_ENVIRONMENT_VARIABLE} must be configured as Base64 for a 32-byte key`);
    this.name = "VoiceProviderEncryptionConfigurationError";
  }
}

export class VoiceProviderSecretDecryptionError extends Error {
  constructor(message = "Stored voice provider secret could not be decrypted") {
    super(message);
    this.name = "VoiceProviderSecretDecryptionError";
  }
}

export interface EncryptedVoiceProviderSecret {
  version: typeof ENCRYPTION_VERSION;
  iv: string;
  ciphertext: string;
  authTag: string;
}

function decodeBase64(value: unknown): Buffer | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function getEncryptionKey(): Buffer {
  const configuredKey = process.env[KEY_ENVIRONMENT_VARIABLE]?.trim();
  const key = decodeBase64(configuredKey);

  if (!key || key.length !== AES_KEY_BYTES) {
    throw new VoiceProviderEncryptionConfigurationError();
  }

  return key;
}

function parseEncryptedSecret(value: unknown): {
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VoiceProviderSecretDecryptionError("Invalid encrypted voice provider secret");
  }

  const envelope = value as Record<string, unknown>;
  if (envelope.version !== ENCRYPTION_VERSION) {
    throw new VoiceProviderSecretDecryptionError("Invalid encrypted voice provider secret");
  }

  const iv = decodeBase64(envelope.iv);
  const ciphertext = decodeBase64(envelope.ciphertext);
  const authTag = decodeBase64(envelope.authTag);
  if (
    !iv ||
    iv.length !== AES_GCM_IV_BYTES ||
    !ciphertext ||
    !authTag ||
    authTag.length !== AES_GCM_TAG_BYTES
  ) {
    throw new VoiceProviderSecretDecryptionError("Invalid encrypted voice provider secret");
  }

  return { iv, ciphertext, authTag };
}

export function encryptVoiceProviderSecret(secret: string): EncryptedVoiceProviderSecret {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Voice provider secret must not be empty");
  }

  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  return {
    version: ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptVoiceProviderSecret(value: unknown): string {
  const encrypted = parseEncryptedSecret(value);
  const key = getEncryptionKey();

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
    decipher.setAuthTag(encrypted.authTag);
    return Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new VoiceProviderSecretDecryptionError();
  }
}
