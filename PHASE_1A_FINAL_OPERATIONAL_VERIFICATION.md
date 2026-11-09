# PHASE 1A — FINAL OPERATIONAL VERIFICATION

**Verification date:** 2026-11-03  
**Result:** `PARTIAL` — the production schema and historical financial data passed verification, and the isolated application passed startup/health checks. Signature generation remains context/restore-sensitive, and the requested ESLint command reports existing errors.

## 1. Scope and production target

This gate performed read-only production queries only. No production migration, schema change, app restart, deployment, posting, purchase, gift, transfer, withdrawal, or historical-data update was performed.

The application configuration and live connection matched the owner-confirmed target:

- Database: `chat_app`
- Server: `127.0.0.1:5432`
- Schema: `public`
- PostgreSQL: `18.4`

The database was treated as the live Hobi database based on the owner's explicit confirmation. No connection string, password, or other credential is included here.

## 2. Backup and isolated restores

- Pre-migration archive: `C:\Users\PC\AppData\Local\HobiBackups\chat_app-phase1a-2026-11-02T21-05-16-773Z.dump` — custom format, 778,458 bytes; its archive listing and isolated restore had previously succeeded.
- Fresh post-migration archive: `C:\Users\PC\AppData\Local\HobiBackups\chat_app-phase1a-postmigration-2026-11-02T21-32-12-310Z.dump` — custom format, 785,625 bytes; `pg_restore --list` succeeded and listed 528 archive entries.
- Both archives were restored with `--exit-on-error --single-transaction --no-owner --no-acl` into separate databases in a temporary UTF-8 PostgreSQL 18.4 cluster bound only to `127.0.0.1`.
- The isolated cluster and application process were stopped; temporary database files were removed. Both backup files remain outside the repository.

## 3. Migration review

Reviewed [the financial-foundation migration](./scripts/migrate-financial-foundation-closeout.mjs), [the coin-purchases migration](./scripts/migrate-coin-purchases.mjs), [the schema definitions](./server/db/migrate.ts), and [the database startup plugin](./server/plugins/database.ts).

### Applied migration behavior

`financial-foundation-v1` runs inside a transaction, sets a bounded lock/statement timeout, and uses `SET LOCAL search_path TO public, pg_catalog`. Before committing, it snapshots all wallet balances and wallet entries and aborts if either snapshot changes. It calls only `ensureFinancialFoundationSchema`; it does not call the wallet-ledger seeding path.

The Phase 1A schema function:

- Changes the allowed wallet bucket and operation-scope checks and adds the site-owner nonnegative check.
- Adds site-owner wallet/idempotency indexes.
- Creates or ensures cash-ledger tables, constraints, indexes, and immutable/no-truncate protection.
- Does not insert or update financial account, balance, operation, or entry rows.

Actual pre- versus post-migration schema signatures show the expected additions/changes to wallet checks and site-owner indexes. No wallet ownership foreign key changed between the pre- and post-migration database snapshots.

`coin-purchases-v1` was not rerun. During `financial-foundation-v1`, `refreshCoinPurchaseSchemaSignature` updated only its `schema_signature` metadata field because the foundation changes affect objects covered by that signature. The coin migration's original `applied_at` remained `2026-11-01 22:38:33 +03`; the refresh did not change it. The foundation migration was recorded once at `2026-11-03 00:21:48 +03`.

The old and refreshed *stored signature records* contain different ownership-FK names/definitions. Inspection of the actual pre/post schema shows these were pre-existing differences between the old signature record and the schema, not a Phase 1A ownership/data change. The pre-migration compatibility check accepted only the migration's explicitly allowed FK/default-expression differences before the metadata refresh.

### Startup behavior

The database startup plugin can call `runAutoMigrations()` when it detects missing schema, and it always runs role/permission/schema bootstrap helpers. Therefore, starting the application against production would not be a read-only test. No production app process was started. Startup testing below used only the isolated restored copy.

## 4. Historical financial data fingerprints

For each table, the same selected columns, `ORDER BY id`, JSON row serialization, and SHA-256 procedure were used against the pre-migration archive restore, post-migration archive restore, and live database. No row contents or personal identifiers are included.

| Table | Before count | Before SHA-256 | After count | After SHA-256 | Match |
|---|---:|---|---:|---|---|
| `wallet_balances` | 20 | `1d9016e9ab5355bdf83789f7e5a174a1b50ef706f356142965e4f814e6da00dc` | 20 | `1d9016e9ab5355bdf83789f7e5a174a1b50ef706f356142965e4f814e6da00dc` | Yes |
| `wallet_entries` | 4 | `d46c9bd1eaeff65718814d0ce22a76073598b68da60ca505d0974f4bf4fcac84` | 4 | `d46c9bd1eaeff65718814d0ce22a76073598b68da60ca505d0974f4bf4fcac84` | Yes |
| `wallet_operations` | 3 | `20f67d28a2fe39cdcc0391987a9c633dd15a5a4646c598716059b5fc920ad1f3` | 3 | `20f67d28a2fe39cdcc0391987a9c633dd15a5a4646c598716059b5fc920ad1f3` | Yes |
| `cash_accounts` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | Yes |
| `cash_operations` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | Yes |
| `cash_entries` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | Yes |

The live database matched the post-migration archive for all six tables. The checkpoint's saved `wallet_operations` baseline string was only 61 characters, so it was not a valid SHA-256 and was not treated as authoritative. The exact before hash above was recovered from the verified pre-migration archive, not reconstructed from current production data. The cash-ledger tables were empty in both snapshots.

## 5. Production schema, guards, and signatures

Read-only production checks found:

- `verifyDatabaseSchema()` reported no missing required tables, wallet/cash columns, or required guards.
- 75 constraints were present and validated.
- 41 indexes on the six ledger tables were valid, ready, and live.
- All 10 expected financial immutability/no-truncate triggers were present and enabled.
- No orphaned wallet/cash references were found in the checked relationships.
- Exactly one record existed for each of `coin-purchases-v1` and `financial-foundation-v1`.
- Both recorded signatures matched the live schema when read under `SET LOCAL search_path TO public, pg_catalog`.

### `search_path` finding

The production session default is `"$user", public`. Reading either signature under that incidental path does **not** match its stored signature. Reading under the explicit migration path `public, pg_catalog` matches both records. The migration entrypoints set this path before signature reads, but the exported signature helper functions do not establish it themselves. The earlier post-check failure is therefore reproducible when a caller omits the explicit path; no production record was changed to address this gate.

Additionally, restoring the post-migration archive changes PostgreSQL's textual rendering of some defaults and check constraints (`column_default` / `pg_get_constraintdef`), so the strict coin signature comparison on the restored copy differs even under the canonical path. This did not affect the live production signature or the application schema verifier, but it means these text-based signatures are not restore-stable. No code change was made under this verification-only authorization.

## 6. Automated tests

Commands were run with `DATABASE_URL` set to a deliberately unreachable test-only endpoint and Redis integration disabled, preventing the suite from using production services:

- `npm test`: **379 total, 378 passed, 0 failed, 1 skipped**. The skipped case is the Redis integration test gated by `REDIS_INTEGRATION_URL`.
- `npx tsc --noEmit`: **passed**, no TypeScript errors.
- `npx eslint server/db/migrate.ts server/plugins/database.ts scripts/migrate-financial-foundation-closeout.mjs scripts/migrate-coin-purchases.mjs scripts/migration-safety.mjs tests/financialFoundationMigration.test.ts tests/cashLedgerSchema.test.ts tests/walletLedgerSchema.test.ts`: **failed with 12 existing lint errors** in `server/db/migrate.ts`: four `@typescript-eslint/no-explicit-any` errors (lines 1475, 2027, 2029, 2326) and eight `no-empty` errors (lines 1832, 1861, 1862, 1865, 1867, 1877, 1978, 1993). These lines are outside the file's changed hunks; they were not altered in this task.

The earlier strict signature check failure was explained by the missing explicit search path. The current production record verifies under the migration's canonical path; the caller/helper context issue and restore-text instability remain documented above.

## 7. Isolated application startup

The application was started with Vite/Nitro bound to loopback (`https://127.0.0.1:3039`) and `DATABASE_URL` pointing only to `phase1a_after` on the temporary PostgreSQL cluster (`127.0.0.1:55439`). Redis was disabled; MinIO was overridden to loopback port 1; site-owner bootstrap credentials were invalidated; proxy variables were cleared.

Verified:

- `GET /` — HTTP 200.
- `GET /api/health` — HTTP 200; `database.connected=true`, `redis.enabled=false`.
- Financial modules imported without invoking posting or any purchase/transfer/gift/withdrawal method: `walletPostingService.ts`, `coinLedgerService.ts`, `cashPostingService.ts`, and `walletAgentAccess.ts`.
- Application `verifyDatabaseSchema()` on the clone reported no missing tables, columns, or guards.
- All six financial table counts and hashes on the clone remained identical after startup and health checks.

No financial route or write test was executed. The MinIO plugin attempted only the configured local dummy endpoint and logged `ECONNREFUSED 127.0.0.1:1`; this was intentional isolation, did not affect health checks, and did not contact production MinIO. Vite also emitted existing configuration/deprecation warnings. The app and temporary database were stopped and removed after testing.

## 8. Outstanding items and closure decision

1. Make schema-signature helpers establish a uniform `search_path` or require a shared explicit transaction context, and make signature serialization stable across dump/restore. This requires a separate authorized code change and regression tests.
2. Resolve the 12 existing ESLint errors in `server/db/migrate.ts` in a separate code-quality task.
3. If a zero-warning operational run is required, provide a local MinIO test service or an approved way to disable its request-hook initialization; the current run intentionally demonstrated the app with external integrations blocked.

The database/schema and historical-data checks passed, and the isolated startup/health gate passed. The full closure criteria are **not** met because the lint command failed and signature handling remains context/restore-sensitive.

```text
PRODUCTION_TARGET_VERIFIED: YES
BACKUP_VERIFIED: YES
PRODUCTION_MIGRATIONS_APPLIED_DURING_THIS_GATE: NO
PRODUCTION_SCHEMA_VERIFIED: YES
HISTORICAL_BALANCES_CHANGED: NO
HISTORICAL_LEDGER_ENTRIES_CHANGED: NO
FINANCIAL_OPERATIONS_EXECUTED: NONE
PRODUCTION_APP_RESTART: NO
PRODUCTION_DEPLOYMENT: NO
PHASE_1A_STATUS: PARTIAL
PHASE_2_AUTHORIZED: NO
```
