import { dbPool } from "../db";
import {
  decryptVoiceProviderSecret,
  encryptVoiceProviderSecret,
} from "./voiceProviderEncryption";

export interface VoiceProviderQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export interface VoiceProviderQueryExecutor {
  query: (text: string, values?: unknown[]) => Promise<VoiceProviderQueryResult>;
}

export interface PublicVoiceProviderAccount {
  id: string;
  name: string;
  url: string;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RequestedVoiceProviderSelection =
  | { provider: "webrtc"; accountId: null }
  | { provider: "livekit"; accountId: string };

export interface CreateVoiceProviderAccountInput {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface UpdateVoiceProviderAccountInput {
  name: string;
  url: string;
  apiKey?: string;
  apiSecret?: string;
}

export class VoiceProviderAccountNotFoundError extends Error {
  constructor() {
    super("Voice provider account was not found");
    this.name = "VoiceProviderAccountNotFoundError";
  }
}

const PUBLIC_ACCOUNT_COLUMNS = `
  id,
  name,
  url,
  api_key_encrypted IS NOT NULL AS has_api_key,
  api_secret_encrypted IS NOT NULL AS has_api_secret,
  created_at,
  updated_at
`;

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Stored voice provider account has invalid ${key}`);
  }
  return value;
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new Error(`Stored voice provider account has invalid ${key}`);
  }
  return value;
}

function requiredTimestamp(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Stored voice provider account has invalid ${key}`);
  }
  return date.toISOString();
}

function toPublicAccount(row: Record<string, unknown>): PublicVoiceProviderAccount {
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    url: requiredString(row, "url"),
    hasApiKey: requiredBoolean(row, "has_api_key"),
    hasApiSecret: requiredBoolean(row, "has_api_secret"),
    createdAt: requiredTimestamp(row, "created_at"),
    updatedAt: requiredTimestamp(row, "updated_at"),
  };
}

function parseSelection(row: Record<string, unknown>): RequestedVoiceProviderSelection {
  const provider = row.provider;
  const accountId = row.livekit_account_id;

  if (provider === "webrtc" && accountId === null) {
    return { provider, accountId: null };
  }
  if (provider === "livekit" && typeof accountId === "string" && accountId.length > 0) {
    return { provider, accountId };
  }
  throw new Error("Stored voice provider selection is invalid");
}

export function createVoiceProviderStore(database: VoiceProviderQueryExecutor = dbPool) {
  const getCredentials = async (
    accountId: string,
  ): Promise<{ apiKey: string; apiSecret: string } | null> => {
    const result = await database.query(
      `SELECT api_key_encrypted, api_secret_encrypted
       FROM voice_provider_accounts
       WHERE id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      apiKey: decryptVoiceProviderSecret(row.api_key_encrypted),
      apiSecret: decryptVoiceProviderSecret(row.api_secret_encrypted),
    };
  };

  return {
    async listAccounts(): Promise<PublicVoiceProviderAccount[]> {
      const result = await database.query(
        `SELECT ${PUBLIC_ACCOUNT_COLUMNS}
         FROM voice_provider_accounts
         ORDER BY created_at ASC, id ASC`,
      );
      return result.rows.map(toPublicAccount);
    },

    async createAccount(
      input: CreateVoiceProviderAccountInput,
    ): Promise<PublicVoiceProviderAccount> {
      const apiKey = encryptVoiceProviderSecret(input.apiKey);
      const apiSecret = encryptVoiceProviderSecret(input.apiSecret);
      const result = await database.query(
        `INSERT INTO voice_provider_accounts
           (id, name, url, api_key_encrypted, api_secret_encrypted)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         RETURNING ${PUBLIC_ACCOUNT_COLUMNS}`,
        [
          input.id,
          input.name,
          input.url,
          JSON.stringify(apiKey),
          JSON.stringify(apiSecret),
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Voice provider account was not created");
      return toPublicAccount(row);
    },

    async updateAccount(
      accountId: string,
      input: UpdateVoiceProviderAccountInput,
    ): Promise<PublicVoiceProviderAccount | null> {
      const apiKey = input.apiKey === undefined
        ? null
        : JSON.stringify(encryptVoiceProviderSecret(input.apiKey));
      const apiSecret = input.apiSecret === undefined
        ? null
        : JSON.stringify(encryptVoiceProviderSecret(input.apiSecret));
      const result = await database.query(
        `UPDATE voice_provider_accounts
         SET name = $2,
             url = $3,
             api_key_encrypted = COALESCE($4::jsonb, api_key_encrypted),
             api_secret_encrypted = COALESCE($5::jsonb, api_secret_encrypted),
             updated_at = now()
         WHERE id = $1
         RETURNING ${PUBLIC_ACCOUNT_COLUMNS}`,
        [accountId, input.name, input.url, apiKey, apiSecret],
      );
      const row = result.rows[0];
      return row ? toPublicAccount(row) : null;
    },

    async deleteAccount(accountId: string): Promise<boolean> {
      const result = await database.query(
        `DELETE FROM voice_provider_accounts
         WHERE id = $1
         RETURNING id`,
        [accountId],
      );
      return result.rows.length > 0;
    },

    getCredentials,

    async getRequestedSelection(): Promise<RequestedVoiceProviderSelection> {
      const result = await database.query(
        `SELECT provider, livekit_account_id
         FROM voice_provider_selection
         WHERE id = 1`,
      );
      const row = result.rows[0];
      return row ? parseSelection(row) : { provider: "webrtc", accountId: null };
    },

    async setRequestedSelection(
      selection: RequestedVoiceProviderSelection,
    ): Promise<RequestedVoiceProviderSelection> {
      if (selection.provider === "livekit") {
        const credentials = await getCredentials(selection.accountId);
        if (!credentials) throw new VoiceProviderAccountNotFoundError();
      }

      const result = await database.query(
        `INSERT INTO voice_provider_selection (id, provider, livekit_account_id)
         VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE
         SET provider = EXCLUDED.provider,
             livekit_account_id = EXCLUDED.livekit_account_id,
             updated_at = now()
         RETURNING provider, livekit_account_id`,
        [selection.provider, selection.accountId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Voice provider selection was not saved");
      return parseSelection(row);
    },
  };
}
