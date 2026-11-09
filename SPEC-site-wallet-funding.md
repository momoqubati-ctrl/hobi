# Spec: Site Wallet Funding

## Objective

Provide the hosting owner with a private, authenticated way to fund the site's single coin-inventory wallet after an external payment. The site wallet is the source from which the site owner later sells coin stock to wallet agents. This module records only the hosting-owner-to-site funding step; agent purchases, member top-ups, payment methods, and reporting are separate modules in `CAPABILITY-MAP-gifts-wallet.md`.

Success means each funding credit is attributable to an authenticated hosting owner, backed by an external reference, balanced in the immutable wallet ledger, and applied at most once. No user-facing or agent balance changes when the funding request is merely submitted.

## Approved Product Decisions

- The site has exactly one coin-inventory wallet, distinct from member and agent wallets.
- The hosting owner funds the site after an external payment. Hobi does not debit an in-system hosting-owner wallet or integrate with a payment provider in this phase.
- The funding amount is a positive integer number of coins. The hosting owner records an external payment reference for audit; this module does not infer a coin/YER conversion rate.
- The site inventory is a single, non-negative system ledger account. An approved funding operation credits site inventory and posts the balancing amount to the existing external-clearing account in one transaction.
- The current ledger supports `system` and `member` actor scopes. Funding operations use the `system` scope and retain the configured hosting-owner identifier in immutable operation metadata; credentials and portal keys are never ledger metadata.
- A normalized external payment reference is unique for this funding operation type, preventing one payment from being credited under a different idempotency key.
- The hosting portal path is supplied through a private runtime environment variable and is not embedded in client code. The path is not an authentication factor: the portal also requires dedicated credentials and an authenticated, secure session.
- The deployment supplies a portal key, username, and scrypt password hash through private environment variables. Production also requires the existing strong `AUTH_SECRET` for signed sessions. Missing or malformed authentication configuration fails closed.
- Missing portal configuration disables access. There is no default secret, password, or wallet balance.
- Payment-provider integration and direct debit from a hosting-owner wallet are out of scope.

## Tech Stack

- React and TypeScript frontend
- Nitro/H3 API routes
- PostgreSQL with `pg` and Drizzle schema definitions
- Existing `wallet_operations`, `wallet_balances`, and immutable `wallet_entries` ledger
- Existing Node.js `node:test` test runner

## Commands

- Tests: `npm test`
- Build: `npm run build`
- Lint: `npm run lint`
- Development server: `npm run dev`
- Wallet schema migration: application startup migration; review migration SQL and use an isolated database for migration tests only

## Project Structure

- `server/db/schema.ts` and `server/db/migrate.ts` — add the site inventory ledger account and idempotent schema migration.
- `server/services/` — authenticated hosting-owner funding and ledger posting.
- `server/routes/api/` — protected funding endpoints and the separate site-owner balance-read endpoint.
- `src/pages/` and `src/components/` — environment-configured hosting-owner portal, funding form, and site-owner wallet view.
- `tests/` — route authorization, validation, idempotency, ledger atomicity, and migration tests.
- `.env.example` — placeholder configuration names only; never store real credentials or portal paths in source control.

## API and Workflow Contract

- A hosting owner authenticates through a private portal path configured at deployment and a dedicated credential-backed login. The login endpoint requires the configured portal key, and the session cookie is `httpOnly`, `secure`, `sameSite=strict`, scoped to the hosting-owner API, and expires after one hour. Login attempts are limited to 10 per IP per 15 minutes.
- The hosting owner calls `POST /api/hosting-owner/fund` with only `amountCoins` and `externalReference` in the body and supplies a stable `Idempotency-Key` header. The amount must be a positive JavaScript safe integer so JSON cannot silently round the value. The server trims and lowercases the external reference before storing it; it must be 1–255 characters and contain no control characters.
- `GET /api/hosting-owner/auth/session` and `GET /api/hosting-owner/balance` use the same portal key and hosting-owner session; the session check returns `authenticated: false` for an unauthenticated visitor, and the balance is returned as a decimal string to preserve bigint precision. Both responses disable caching and reveal no credential or token.
- `GET /api/site-owner/wallet` uses the ordinary signed member session but independently verifies the configured site-owner username and its active assignment to the protected `__site_owner__` role. It returns only the site-inventory balance as a decimal string, disables caching, and performs no writes. This is a separate read-only application view; it does not grant access to the hosting-owner portal, funding operations, or ledger history.
- The server derives the actor from the authenticated session; the request cannot specify an actor, target wallet, balance, or ledger account. The schema migration idempotently creates both system account rows (`site_inventory` and `external_clearing`) with zero balances; funding still fails closed without writes if either row is absent.
- The server claims an idempotency key atomically. Reuse with the same canonical payload returns the original result; reuse with a different payload is rejected.
- A successful funding operation creates one immutable system-scoped operation with the configured hosting-owner identifier and balanced ledger entries that increase the sole site-inventory balance and decrease external clearing. The external reference cannot already be attached to another site-funding operation. Both entries and the materialized balance update commit or roll back together.
- The operation result exposes the amount, external reference, operation identifier, and resulting site-wallet balance to the authenticated hosting owner only. It never returns credential or session data.
- The same idempotency key and canonical request replay the original operation and recorded post-funding balance. A different payload under that key or a previously used external reference returns a conflict.
- The private portal displays the authenticated owner's inventory balance, requests explicit confirmation that the external transfer was verified, and presents the recorded operation result. A failed submission retains its idempotency key for retries in the same page session; it does not persist payment details in browser storage.
- The signed-in site-owner member can view the same site-inventory balance in a read-only dashboard tab. The tab is shown only when the server reports the protected role, and its API independently checks the authenticated account and role assignment.
- The site owner and wallet agents cannot use this portal or fund the site inventory.

## Code Style

Follow the existing parameterized PostgreSQL and transaction patterns. H3 handlers validate the body fields and `Idempotency-Key` header, derive the owner username from the verified session, and pass only those trusted values to the funding service. Use integer coin units, explicit error codes, one database transaction per financial operation, and no broad catch that converts a failure into success.

## Testing Strategy

- Unit tests: integer/reference validation, request fingerprint stability, and different-payload idempotency conflicts.
- Service tests: balanced postings, one-time credit, rollback on partial failure, and concurrent duplicate requests.
- Route tests: missing configuration, unauthenticated/invalid sessions, wrong role, malformed input, and successful response field allowlisting.
- Site-owner read tests: unauthenticated, non-owner, and unassigned reserved-username sessions are denied before balance access; an authorized owner receives only the balance.
- Migration tests: idempotent schema creation and account constraints in an isolated database or the repository's migration test harness.
- Run `npm test`, `npm run build`, and focused lint for changed files. Do not execute migrations against production or shared live data.

## Boundaries

- Always: authenticate every funding action; authorize only the hosting-owner identity; validate amount and reference; use parameterized SQL; lock affected accounts deterministically; use idempotency; write balanced immutable entries atomically; keep the external clearing account and site inventory in sync.
- Always: keep portal secrets out of the bundle, logs, responses, tests, and version control. Commit only placeholder variable names in `.env.example`.
- Ask first: changing the external-funding model, adding an internal hosting-owner wallet, introducing an exchange rate, accepting uploaded payment proof, or enabling a provider integration.
- Never: treat a hidden URL as sufficient authorization; trust a client-supplied actor or balance; credit the site from a browser-only action; rewrite or delete financial history; run a migration against production/shared data without explicit approval.

## Success Criteria

- Exactly one site inventory account is created and cannot be selected by a client.
- Only a successfully authenticated hosting owner can create a funding credit.
- Missing environment configuration fails closed.
- A transfer reference is required and bounded; amounts must be positive integers within the database's supported range.
- Funding credits site inventory and records the balancing external-clearing entry atomically.
- Concurrent/retried identical requests cannot fund the site twice; the same key with changed input is rejected.
- The private portal displays the owner-only inventory balance and funding result, and prevents submitting before transfer confirmation.
- The site-owner dashboard shows a separate read-only inventory balance only to the account assigned to the protected site-owner role; no other member can retrieve it through the API.
- A failure between ledger and balance updates rolls the entire transaction back.
- No migration or backfill is run against a production/shared database during development.

## Open Questions

- The deployment operator must provide the hosting portal path and dedicated credential hash through private environment configuration before enabling the portal. No real values are to be committed or shared in code.
- The legally required retention period for external payment references and funding audit records must be confirmed before production launch.

## References

- [Capability map](./CAPABILITY-MAP-gifts-wallet.md)
- [Wallet ledger specification](./SPEC-wallet-ledger.md)
