import crypto from "node:crypto";

/**
 * 31-character alphabet for public_user_id (strictly excludes 0, O, 1, I, L to prevent visual ambiguity)
 * Space: 31^12 = 786,307,842,422,968,801 combinations
 */
export const PUBLIC_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PUBLIC_ID_REGEX = /^[2-9A-HJ-NP-Z]{12}$/;

/**
 * Generates a cryptographically secure 12-character public user ID
 */
export function generatePublicUserId(): string {
  const bytes = crypto.randomBytes(12);
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += PUBLIC_ID_ALPHABET[bytes[i] % PUBLIC_ID_ALPHABET.length];
  }
  return id;
}

/**
 * Validates a 12-character public user ID format
 */
export function isValidPublicUserId(id: unknown): id is string {
  return typeof id === "string" && PUBLIC_ID_REGEX.test(id.trim());
}

/**
 * Validates a mention_name (2-64 chars, Arabic/Latin letters, digits, _, -)
 */
export const MENTION_NAME_REGEX = /^[\p{L}\p{N}_-]{2,64}$/u;

export function isValidMentionName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return MENTION_NAME_REGEX.test(trimmed) && !trimmed.startsWith("_") && !trimmed.endsWith("_");
}

/**
 * Sanitizes an input string into a clean, normalized mention_name
 */
export function sanitizeMentionName(raw: string, fallback = "user"): string {
  if (!raw || typeof raw !== "string") return `${fallback}_${crypto.randomBytes(2).toString("hex")}`;
  let s = raw.normalize("NFKC").toLowerCase().trim();
  // Replace spaces and separators with underscore
  s = s.replace(/[\s._-]+/g, "_");
  // Keep only unicode letters, digits, and underscores
  s = s.replace(/[^\p{L}\p{N}_]/gu, "");
  // Strip leading and trailing underscores
  s = s.replace(/^_+|_+$/g, "");
  if (!s || s.length < 2) {
    s = `${fallback}_${crypto.randomBytes(2).toString("hex")}`;
  }
  return s.slice(0, 32);
}
