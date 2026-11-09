import { createHash } from "node:crypto";
import { verifyAuthToken } from "../services/authService";

export function getSocketAuthClaims(
  handshakeAuth: unknown,
  now = Date.now(),
) {
  if (!handshakeAuth || typeof handshakeAuth !== "object" || Array.isArray(handshakeAuth)) {
    return null;
  }

  const token = (handshakeAuth as Record<string, unknown>).token;
  if (typeof token !== "string") return null;

  const claims = verifyAuthToken(token, now);
  return claims && claims.type === undefined
    ? { ...claims, sessionId: createHash("sha256").update(token).digest("base64url") }
    : null;
}
