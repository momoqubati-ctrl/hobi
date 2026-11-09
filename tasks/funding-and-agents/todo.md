# Task List: Site Wallet Funding

Spec: [SPEC-site-wallet-funding](../../SPEC-site-wallet-funding.md)  
Plan: [Implementation Plan](./plan.md)

## Phase 1: Ledger and portal foundations

- [x] **Task 1 — Extending site inventory ledger schema**
  - Acceptance: the ledger supports exactly one `system:site_inventory` account; site inventory cannot go negative; the existing member/system constraints remain intact; external references are unique for site-funding operations; migration is idempotent and does not create an opening balance.
  - Verify: focused schema and migration tests.
  - Files: `server/db/schema.ts`, `server/db/migrate.ts`, `tests/walletLedgerSchema.test.ts`, `tests/coinLedgerMigration.test.ts`.
  - Dependencies: none.

- [x] **Task 2 — Configuring the private hosting-owner portal path**
  - Acceptance: a strong URL-safe key is read from private runtime configuration; malformed or missing configuration fails closed; the path is validated in constant time; `.env.example` contains names/placeholders only; an API readiness check does not reveal the configured key.
  - Verify: focused portal-key tests and endpoint tests.
  - Files: `server/services/hostingOwnerPortal.ts`, `server/routes/api/hosting-owner/portal.get.ts`, `tests/hostingOwnerPortal.test.ts`, `.env.example`.
  - Dependencies: none.

- [x] **Task 3 — Authenticating hosting-owner sessions**
  - Acceptance: configured username and scrypt password hash are validated server-side; the issued signed token is distinctly typed as `hosting_owner`; only that token type/role passes the hosting-owner guard; configuration failures never authenticate; secrets are not returned.
  - Verify: auth service tests cover valid/invalid credentials, malformed config, token expiry, and role/type separation.
  - Files: `server/services/authService.ts`, `server/services/hostingOwnerAuthService.ts`, `server/services/hostingOwnerAccess.ts`, `tests/hostingOwnerAuthService.test.ts`.
  - Dependencies: Task 2.

- [x] **Task 4 — Isolating hosting-owner sessions from generic endpoints**
  - Acceptance: host-owner tokens are rejected by generic member authentication, admin authentication, user-context, and wall-upload handlers; only the hosting-owner guard accepts a correctly typed host-owner session.
  - Verify: route tests submit a valid host-owner token to member-context and wall-upload endpoints and confirm both reject it before database or upload work.
  - Files: `server/services/adminAccess.ts`, `server/routes/api/auth/me.get.ts`, `server/routes/api/wall/upload.post.ts`, `tests/hostingOwnerAuthService.test.ts`.
  - Dependencies: Task 3.

- [x] **Task 5 — Protecting hosting-owner authentication endpoints**
  - Acceptance: login validates the portal key and input, sets a bounded `httpOnly`/`secure`/`sameSite` cookie, and returns generic credential errors; logout clears the cookie; the existing auth rate-limit category includes hosting-owner login; protected requests reject missing, expired, wrong-role, and wrong-portal sessions.
  - Verify: focused route tests for login/logout and access control.
  - Files: `server/routes/api/hosting-owner/auth/login.post.ts`, `server/routes/api/hosting-owner/auth/logout.post.ts`, `server/middleware/rateLimiter.ts`, `tests/hostingOwnerAuthRoutes.test.ts`.
  - Dependencies: Tasks 2, 3, and 4.

## Phase 2: Funding transaction

- [x] **Task 6 — Posting idempotent site-wallet funding**
  - Acceptance: a positive integer coin amount and normalized external reference create one system-scoped operation; immutable metadata records the configured hosting-owner identifier; balanced entries credit site inventory and debit external clearing; repeated idempotency keys replay only matching requests; duplicate external references conflict; all writes roll back together.
  - Verify: service and route tests cover unauthorized actors, invalid amounts/references, duplicate keys/references, insufficient/missing account state, atomic rollback, and balanced postings.
  - Files: `server/services/siteWalletFundingService.ts`, `server/routes/api/hosting-owner/fund.post.ts`, `tests/siteWalletFundingService.test.ts`, `tests/siteWalletFundingApi.test.ts`.
  - Dependencies: Tasks 1 and 5.

- [x] **Task 7 — Building the hosting-owner funding screen**
  - Acceptance: the portal is reachable only through the configured path; unauthenticated users see login; the form submits amount and external reference with a retry-stable idempotency key; balance/result/errors are visible only to the authenticated hosting owner; no secret is rendered or fetched into public configuration.
  - Verify: production build, focused API tests, and browser check using mocked responses with no live financial writes.
  - Files: `src/App.tsx`, `src/pages/HostingOwnerPortal.tsx`, `src/components/hosting-owner/`, `src/lib/hosting-owner-portal-api.ts`, `src/lib/site-wallet-funding-intent.ts`, `server/routes/api/hosting-owner/auth/session.get.ts`, `server/routes/api/hosting-owner/balance.get.ts`.
  - Dependencies: Tasks 2, 5, and 6.

## Phase 3: Verification

- [ ] **Task 8 — Verifying site-wallet funding**
  - Acceptance: all focused tests, the full test suite, build, and changed-file lint pass; migration SQL is reviewed; no live/shared migration is applied.
  - Verify: `npm test`, `npm run build`, and `npm run lint` (or focused ESLint if the repository baseline has unrelated lint failures).
  - Files: changed funding source/tests and this task list if status needs updating.
  - Dependencies: Task 7.
  - Current verification: `npm test` passes 267 tests; `npm run build`, `npx tsc --noEmit`, and focused lint for the new route, panel, and tests pass. ESLint on the already-modified `src/pages/Dashboard.tsx` still reports existing `any` violations outside this feature's lines.
  - Production note: an attempted browser preview started the full Nitro server with the local `.env`, so its database initializer ran. A read-only audit found no recent site-funding operation or wallet-account balance update. The current schema has no missing required tables, wallet guards, or checked startup columns; the site-owner account has its protected role, 357 application permissions, no `hosting_owner.*` permissions, and a valid non-expiring assignment. Recent account/role timestamps fall in the same window as the earlier owner bootstrap and cannot be attributed specifically to the preview. The initializer runs several idempotent schema checks and owner/profile backfills on startup; without a pre-preview schema/data snapshot or DDL audit log, it is not possible to determine which of those operations changed production state or whether the conditional general migration ran.
  - Login follow-up: read-only comparison confirmed the configured site-owner hash matched the stored account hash. The `localhost:3000` workspace Vite/Nitro process had started about 80 minutes before the latest `.env` save, and its login failures were not present in the currently configured `chat_app` access log. With user approval, that exact process was restarted; the server now reports ready with its database connected. Nitro initialization ran again. A post-start read-only check confirms the owner account remains active with its protected-role assignment and matching configured hash, and no recent site-wallet funding operation or wallet-account update occurred. The screenshot exposed the entered password; rotate it before further use.

## Phase 4: Site-owner read-only wallet access

- [x] **Displaying the site inventory balance to the site owner**
  - Acceptance: a separate dashboard tab shows only the site's current inventory balance; the API requires a valid member token, the configured site-owner username, and an active assignment to the protected site-owner role.
  - Acceptance: balance reads are uncached and read-only; no funding action, ledger history, or balance mutation is exposed.
  - Verify: focused route tests deny missing sessions, hosting-owner sessions, other usernames, and an unassigned reserved username before reading the balance; successful access returns only the balance.
  - Files: `server/routes/api/site-owner/wallet.get.ts`, `src/components/site-owner/SiteOwnerWalletPanel.tsx`, `src/pages/Dashboard.tsx`, `tests/siteOwnerWalletApi.test.ts`.

## Checkpoint: Complete

- [ ] The hosting owner can record an external funding credit exactly once.
- [ ] Site inventory and external clearing remain balanced and auditable.
- [ ] Existing `provider-admin` work and unrelated dirty files remain untouched.
- [ ] No production/shared database was modified.
