const SITE_OWNER_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SCRYPT_PASSWORD_HASH_PATTERN = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;

export type SiteOwnerBootstrapConfig = {
  username: string;
  passwordHash: string;
};

export const SITE_OWNER_ROLE_NAME = "__site_owner__";
export const SITE_OWNER_DISPLAY_NAME = "مالك الموقع";
export const SITE_OWNER_RANK = 90_000;

export const isSiteOwnerRoleName = (name: unknown): boolean =>
  String(name || "").trim().toLowerCase() === SITE_OWNER_ROLE_NAME;

export const getConfiguredSiteOwnerUsername = (
  environment: NodeJS.ProcessEnv = process.env,
): string | null => {
  const username = environment.SITE_OWNER_USERNAME?.trim().toLowerCase();
  return username && SITE_OWNER_USERNAME_PATTERN.test(username) ? username : null;
};

export const getSiteOwnerPermissionKeys = (
  resourceActions: Record<string, readonly string[]>,
): string[] => Object.entries(resourceActions)
  .flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`))
  .filter((permissionKey) => !permissionKey.startsWith("hosting_owner."));

export const getSiteOwnerBootstrapConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): SiteOwnerBootstrapConfig | null => {
  const username = getConfiguredSiteOwnerUsername(environment);
  const passwordHash = environment.SITE_OWNER_PASSWORD_HASH?.trim();

  if (
    !username ||
    !passwordHash ||
    !SCRYPT_PASSWORD_HASH_PATTERN.test(passwordHash)
  ) {
    return null;
  }

  return { username, passwordHash };
};

export const isSiteOwnerUsername = (
  username: unknown,
  configuredUsername: string | null = getConfiguredSiteOwnerUsername(),
): boolean => Boolean(
  configuredUsername &&
  String(username || "").trim().toLowerCase() === configuredUsername,
);
