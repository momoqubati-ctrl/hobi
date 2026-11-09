import { getHeader, type H3Event, setResponseStatus } from "h3";
import { dbPool } from "../db";
import { verifyAuthToken } from "./authService";
import {
  getConfiguredSiteOwnerUsername,
  isSiteOwnerUsername,
  SITE_OWNER_ROLE_NAME,
} from "./siteOwner";

const BOOTSTRAP_MARKER = "site_owner_bootstrap";

export const hasProtectedSiteOwnerRole = async (userId: string, username: string) => {
  const result = await dbPool.query<{ authorized: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM "users" u
       JOIN "user_role_assignments" assignment ON assignment."user_id" = u."id"
       JOIN "roles" role ON role."id" = assignment."role_id"
       WHERE CAST(u."id" AS text) = $1
         AND lower(trim(u."username")) = $2
         AND role."name" = $3
         AND role."legacy_metadata"->>'managed_by' = $4
         AND role."is_active" = true
         AND assignment."starts_at" <= now()
         AND (assignment."expires_at" IS NULL OR assignment."expires_at" > now())
     ) AS "authorized"`,
    [userId, username, SITE_OWNER_ROLE_NAME, BOOTSTRAP_MARKER],
  );
  return result.rows[0]?.authorized === true;
};

export const getSiteOwnerContext = async (event: H3Event) => {
  const authorization = getHeader(event, "authorization") || "";
  const bearerToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
  const claims = verifyAuthToken(bearerToken);
  if (!claims || claims.type !== undefined || claims.role.toLowerCase() === "guest") {
    return { ok: false as const, statusCode: 401, message: "يلزم تسجيل الدخول" };
  }

  const configuredUsername = getConfiguredSiteOwnerUsername();
  if (!configuredUsername) {
    return { ok: false as const, statusCode: 503, message: "ميزة مالك الموقع غير مهيأة" };
  }
  if (!isSiteOwnerUsername(claims.username, configuredUsername)) {
    return { ok: false as const, statusCode: 403, message: "غير مصرح لمالك الموقع" };
  }
  if (!(await hasProtectedSiteOwnerRole(claims.sub, configuredUsername))) {
    return { ok: false as const, statusCode: 403, message: "غير مصرح لمالك الموقع" };
  }

  return { ok: true as const, id: claims.sub, username: configuredUsername };
};

export const requireSiteOwner = async (event: H3Event) => {
  const owner = await getSiteOwnerContext(event);
  if (!owner.ok) setResponseStatus(event, owner.statusCode);
  return owner;
};
