# Task List: Wallet Ledger

Spec: [SPEC-wallet-ledger](../../SPEC-wallet-ledger.md)  
Plan: [tasks/gifts-wallet/plan.md](./plan.md)

## Phase 1: Ledger foundation

- [ ] **wallet-ledger-schema — Add source-aware ledger schema and append-only guards**
  - Acceptance: `wallet_operations`, `wallet_balances`, and `wallet_entries` model member/system accounts, source eligibility, actor-scoped idempotency fingerprints, and immutable postings.
  - Verify: schema tests cover account/bucket constraints, partial uniqueness, nonnegative member balances, and append-only protections.
  - Files: `server/db/schema.ts`, `server/db/migrate.ts`, `tests/coinLedgerMigration.test.ts`
  - Dependencies: none.
  - **Gate:** concrete schema and cutover design approved; do not apply the opening migration to a production/shared database.

- [ ] **wallet-ledger-cutover — Add explicit opening migration and legacy-write fence**
  - Acceptance: schema startup does not backfill; one explicit transaction locks legacy balances, inserts the opening marker/entries/accounts atomically, and blocks legacy `coins` writes and generic admin wallet mutations after commit.
  - Verify: isolated migration tests prove rollback on failure, rerun safety, marker gating, and legacy write rejection.
  - Files: `server/db/migrate.ts`, `server/db/walletBackfill.ts`, `scripts/migrate-wallet-ledger.mjs`, `server/services/legacyAdminService.ts`, `tests/coinLedgerMigration.test.ts`
  - Dependencies: `wallet-ledger-schema`.

- [ ] **wallet-ledger-postings — Implement atomic source-aware movements**
  - Acceptance: integer credits/debits, recipient splits, platform fees, and source eligibility are recorded atomically; actor-scoped retries with changed request fingerprints conflict; no source balance can become negative.
  - Verify: focused tests cover insufficient balance, mixed legacy/cashable sources, fee conservation, changed-payload key reuse, and concurrent debits.
  - Files: `server/services/coinLedgerService.ts`, `tests/coinLedgerService.test.ts`
  - Dependencies: `wallet-ledger-schema`, `wallet-ledger-cutover`.

- [ ] **wallet-ledger-reservations — Add holds, releases, settlement, and full reversals**
  - Acceptance: a hold reduces available balance once; release or settlement can occur only once; full reversals are linked and one-time, and fail for manual review if the receiver spent the amount.
  - Verify: tests cover pending cash-out holds, rejection/cancellation release, successful settlement, repeated commands, reversal linkage, and insufficient reversal balance.
  - Files: `server/services/coinLedgerService.ts`, `tests/coinLedgerService.test.ts`
  - Dependencies: `wallet-ledger-postings`.

## Checkpoint: Ledger foundation

- [ ] All ledger invariants pass tests.
- [ ] Legacy migration is idempotent and preserves source eligibility.
- [ ] No shared or production database was modified.

## Phase 2: Existing gift flow and wallet read path

- [ ] **wallet-gift-cutover — Route gift sends through authenticated ledger posting**
  - Acceptance: sender identity comes from the authenticated request; gift price and source allocations are server-calculated; debit, recipient credit, fee, and transaction reference commit atomically.
  - Verify: tests reject guests/forged sender IDs, insufficient funds, self-gifts, and duplicate requests; successful posting conserves value.
  - Files: `server/services/giftService.ts`, `server/routes/api/gifts/send.post.ts`, `src/components/chat/GiftStore.tsx`, `tests/giftLedgerIntegration.test.ts`
  - Dependencies: `wallet-ledger-postings`.

- [ ] **wallet-balance-view — Expose and display ledger-backed balances**
  - Acceptance: the API derives the member from the verified token and returns spendable total plus cash-out-eligible amount; the store shows both without accepting a client user ID as authority.
  - Verify: tests cover unauthenticated access, another-user ID attempts, correct legacy/cashable balances, and service errors; legacy profile/stat reads use ledger totals after cutover.
  - Files: `server/routes/api/gifts/coins.get.ts`, `src/components/chat/GiftStore.tsx`, related profile/stat read services, `tests/walletBalanceApi.test.ts`
  - Dependencies: `wallet-ledger-schema`, `wallet-ledger-cutover`, `wallet-ledger-postings`.

## Checkpoint: Wallet flow

- [ ] Existing gift sends use the ledger and server-authenticated sender.
- [ ] Balance display matches the ledger and exposes cash-out eligibility separately.
- [ ] Guests and forged sender IDs cannot change or read another user's financial balance.

## Phase 3: Final verification

- [ ] **wallet-ledger-verification — Verify the approved module**
  - Acceptance: all wallet-ledger success criteria pass; changes remain within the approved module; migration and financial risk notes are documented.
  - Verify: `npm test`, `npm run build`, `npm run lint`, and review the migration SQL without applying it to live data.
  - Files: changed wallet-ledger source/tests and `SPEC-wallet-ledger.md` only if an approved decision changes.
  - Dependencies: `wallet-balance-view`.

## Checkpoint: Complete

- [ ] Tests, build, and lint pass.
- [ ] All migrations were tested only against an isolated database.
- [ ] The user reviewed and approved the plan before implementation.
