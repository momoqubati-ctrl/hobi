# Spec: Site Owner Bootstrap

## Objective

Provision one distinct application member named `مالك الموقع` and a dedicated system permission group during installation/startup. This identity is separate from the hosting-owner account `safarihost` and its `__system_owner__` role. It receives application permissions only and must never acquire the hosting-owner portal identity or privileges.

The configured site-owner username and scrypt password hash are supplied as private runtime environment variables. Bootstrap must be idempotent, must never reset an existing password, and must not elevate an unrelated user if the configured username is already taken.

This module covers identity and role provisioning only. Associating or displaying the site wallet is specified separately by the approved capability map.

## Approved Product Decisions

- The site owner is a separate member account; do not reuse or rename `safarihost`.
- The display name is `مالك الموقع`; the login username is configured at deployment.
- Credentials come from `SITE_OWNER_USERNAME` and `SITE_OWNER_PASSWORD_HASH`. Store no plaintext password and provide no default credentials.
- Grant every application permission key defined by the permission engine, except the hosting-owner portal permission. The role is not the hosting-owner system-owner role and must not receive hosting-owner portal access.
- The dedicated role cannot be edited or deleted by administrators. Controlled application migrations may add permission keys as the application permission catalog evolves.
- Creating the account, role, role assignment, and profile is repeatable and safe under concurrent application startup.
- No wallet balance or legacy coin balance is created or changed by this module.
- If bootstrap settings are missing or invalid, report the owner feature as unavailable and create no partial or privileged records; unrelated application functionality may continue.

## Tech Stack

- TypeScript and Node.js
- Nitro server plugin for database initialization
- PostgreSQL using `pg`; role permissions use the existing `roles`, `role_permissions`, and `user_role_assignments` tables
- Existing authentication uses scrypt password hashes and signed sessions
- Existing tests use Node.js `node:test`, imported through `jiti`

## Commands

- Focused tests: `node --input-type=module -e "import { createJiti } from 'jiti'; const jiti = createJiti(import.meta.url); await jiti.import('./tests/siteOwnerBootstrap.test.ts');"`
- Full tests: `npm test`
- Type check: `npx tsc --noEmit`
- Build: `npm run build`
- Focused lint: `npx eslint server/db/migrate.ts server/plugins/database.ts server/services/systemOwner.ts server/services/permissionEngine.ts tests/siteOwnerBootstrap.test.ts`
- Development server: `npm run dev`

## Project Structure

- `server/services/systemOwner.ts` — reserved system identities and role identifiers.
- `server/services/permissionEngine.ts` — canonical application permission catalog.
- `server/db/migrate.ts` — transactional, repeatable bootstrap for the account, group, permissions, profile, and assignment.
- `server/plugins/database.ts` — await bootstrap before the app treats database initialization as complete.
- `server/routes/api/auth/register.post.ts` and related registration services — prevent public registration from claiming the configured reserved username.
- `server/routes/api/admin/roles.*` and related role services — reject administrator changes/deletion of the protected group and its grants.
- `tests/siteOwnerBootstrap.test.ts` — bootstrap, idempotency, collision, permission-boundary, and protection tests.
- `.env.example` — placeholder names and format guidance only; never add real credentials.

## Code Style

Follow the existing parameterized PostgreSQL and transaction conventions. Provision account, role, grants, assignment, and profile as one transaction; treat the role identifier and all configured usernames as reserved values.

```ts
await client.query(
  `INSERT INTO "role_permissions"
    ("role_id", "permission_key", "permission_value", "source")
   VALUES ($1, $2, 'true'::jsonb, 'site_owner_bootstrap')
   ON CONFLICT ("role_id", "permission_key") DO NOTHING`,
  [roleId, permissionKey],
);
```

## Testing Strategy

- Unit tests: validate the username and scrypt hash configuration; missing or malformed credentials create no partial records.
- Bootstrap tests: first startup creates exactly one account, role, assignment, profile, and each eligible permission; repeated and concurrent startup does not duplicate records or overwrite the password hash.
- Collision tests: an unrelated pre-existing account with the configured username is never promoted; bootstrap fails explicitly and rolls back.
- Permission tests: the new group receives the current application permission catalog but not hosting-owner portal access; the existing `safarihost` account and role remain unchanged.
- Authorization tests: role edit/delete and permission-grant mutation attempts through admin APIs are rejected for the protected group.
- Database tests: triggers/constraints prevent protected role deletion or mutation outside supported bootstrap/migration operations.
- Run the focused tests, then full tests, type check, build, and focused lint. Do not apply a new production migration without separate authorization and a reviewed, schema-only execution path.

## Boundaries

- Always: keep the site owner separate from `safarihost`; validate all bootstrap settings; hash/verify credentials with the existing scrypt format; parameterize SQL; perform provisioning atomically; invalidate cached permissions after changes; log provisioning failures without exposing hashes or secrets.
- Always: reserve the configured username from public registration and refuse to claim an existing unrelated account.
- Always: if bootstrap configuration is missing/invalid, emit an explicit configuration error, leave the site-owner feature disabled, and allow unrelated application functionality to continue.
- Database triggers prevent ordinary role/grant DML and admin API changes, but the application database credential can set the transaction-local bootstrap flag; database credentials and owners remain trusted and can bypass this protection. This is a guard against accidental/unsupported mutations, not a boundary against a compromised database credential.
- Ask first: production schema changes, changes to the authentication/session model, or any expansion into the hosting-owner portal.
- Never: commit secrets, store plaintext passwords, grant hosting-owner portal access to the site-owner member, create a partial owner identity after bootstrap failure, or modify existing user balances.

## Success Criteria

- With valid environment configuration, startup creates exactly one active `مالك الموقع` member and one dedicated protected role, and links them idempotently.
- The account authenticates through the normal member sign-in flow using the configured password hash.
- Every current application permission key is present for the role except the hosting-owner portal permission; the role is not marked as the hosting-owner `is_owner` role.
- The `safarihost` account, its role, and the hosting-owner portal remain distinct and unchanged.
- Admin APIs cannot rename, edit, deactivate, delete, or change grants for the protected group; protected database records cannot be deleted or modified by ordinary SQL operations.
- Missing/invalid configuration produces an explicit error, creates no partial account, group, grants, or assignment, and does not prevent unrelated application features from serving requests.
- Username collision produces an explicit bootstrap failure and no partial account, group, grants, or assignment.
- Repeated/concurrent initialization creates no duplicates and never overwrites an established password hash.
- No wallet or legacy balance is changed.
