import { issueHostingOwnerToken } from "./authService";
import { verifyAgentPassword } from "./agentAuthService";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const PASSWORD_HASH_PATTERN = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;

export class HostingOwnerAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HostingOwnerAuthError";
  }
}

type HostingOwnerCredentials = {
  username: string;
  passwordHash: string;
};

const getConfiguredCredentials = (): HostingOwnerCredentials | null => {
  const username = process.env.HOSTING_OWNER_USERNAME?.trim().toLowerCase();
  const passwordHash = process.env.HOSTING_OWNER_PASSWORD_HASH?.trim();
  if (
    !username ||
    !USERNAME_PATTERN.test(username) ||
    !passwordHash ||
    !PASSWORD_HASH_PATTERN.test(passwordHash)
  ) {
    return null;
  }
  return { username, passwordHash };
};

export const authenticateHostingOwner = async (username: string, password: string) => {
  const credentials = getConfiguredCredentials();
  if (!credentials) {
    throw new HostingOwnerAuthError(
      "HOSTING_OWNER_AUTH_NOT_CONFIGURED",
      "بوابة مالك الاستضافة غير مهيأة",
    );
  }
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 128 ||
    password.length === 0 ||
    password.length > 256
  ) {
    throw new HostingOwnerAuthError(
      "INVALID_HOSTING_OWNER_CREDENTIALS",
      "بيانات الدخول غير صحيحة",
    );
  }

  const validPassword = verifyAgentPassword(password, credentials.passwordHash);
  if (username.trim().toLowerCase() !== credentials.username || !validPassword) {
    throw new HostingOwnerAuthError(
      "INVALID_HOSTING_OWNER_CREDENTIALS",
      "بيانات الدخول غير صحيحة",
    );
  }

  return {
    token: issueHostingOwnerToken({ username: credentials.username }),
    owner: { username: credentials.username },
  };
};
