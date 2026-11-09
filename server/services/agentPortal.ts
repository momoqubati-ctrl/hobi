import { timingSafeEqual } from "node:crypto";

const PORTAL_KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export const getAgentPortalPath = (
  configuredKey = process.env.WALLET_AGENT_PORTAL_KEY,
): string | null => {
  if (!configuredKey || !PORTAL_KEY_PATTERN.test(configuredKey)) return null;
  return `/agent/${configuredKey}`;
};

export const isValidAgentPortalKey = (
  candidate: string | undefined,
  configuredKey = process.env.WALLET_AGENT_PORTAL_KEY,
): boolean => {
  if (
    !candidate ||
    !configuredKey ||
    !PORTAL_KEY_PATTERN.test(candidate) ||
    !PORTAL_KEY_PATTERN.test(configuredKey)
  ) {
    return false;
  }

  const candidateBytes = Buffer.from(candidate);
  const configuredBytes = Buffer.from(configuredKey);
  return candidateBytes.length === configuredBytes.length && timingSafeEqual(candidateBytes, configuredBytes);
};
