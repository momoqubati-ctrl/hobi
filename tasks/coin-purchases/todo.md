# Task List: Coin Purchases Through Agents

Plan: [Implementation Plan](./plan.md)

## Phase 1: Ledger and purchase contracts

- [x] **Task 1 — Adding agent inventory and purchase schema**
  - Acceptance: agent inventory is represented in the existing ledger; purchase/order tables have constrained states, immutable price/payment snapshots, and unique references; migration is additive and idempotent.
  - Verification: focused Drizzle schema and migration tests; inspect generated SQL; no production write during tests.
  - Dependencies: none.

- [x] **Task 2 — Settling site-to-agent inventory purchases**
  - Acceptance: an agent submits a stock request; the authorized site owner verifies the external payment and approves a quoted amount; the transaction atomically debits site inventory and credits only that agent; insufficient stock, duplicate approval, and mismatched idempotency requests fail safely.
  - Verification: service tests cover request validation, duplicate retries, insufficient inventory, and ledger settlement. PostgreSQL concurrency/rollback coverage remains tracked below.
  - Dependencies: Task 1.

- [x] **Task 3 — Configuring agent retail packages**
  - Acceptance: each active agent manages their own positive coin packages, integer minor-unit price, three-letter currency code, and bounded payment instructions; other agents cannot read or alter private settings; changes do not settle funds.
  - Verification: focused service/API tests cover validation, ownership, inactive agents, and price snapshots.
  - Dependencies: Task 1.

## Checkpoint: Inventory and pricing

- [x] Focused tests pass and neither flow creates unbalanced or unbacked coins.
- [x] Production migration remains a separate explicit deployment step.

## Phase 2: Member purchases

- [x] **Task 4 — Submitting private member purchase requests**
  - Acceptance: authenticated members submit a listed package, payment reference, and validated receipt; the server snapshots current agent terms and stores no public object URL.
  - Verification: upload/API tests reject guests, spoofed identities, malformed files, oversized receipts, inactive agents/packages, and duplicate references.
  - Dependencies: Task 3.

- [x] **Task 5 — Reviewing and settling member purchases**
  - Acceptance: only the selected active agent can approve/reject; approval atomically debits that agent's inventory and credits the member's cashable balance exactly once; request snapshots and audit history are retained.
  - Verification: service tests cover insufficient inventory, idempotent retries, and cross-agent access. PostgreSQL concurrency/rollback and authenticated API success coverage remain tracked below.
  - Dependencies: Tasks 1, 3, and 4.

- [x] **Task 6 — Building agent and site-owner purchase controls**
  - Acceptance: agents manage packages, instructions, stock requests, and member reviews; the site owner manages quotes and sees private agent stock proofs; all mutations require the corresponding session and ownership.
  - Verification: build, focused API tests, and browser checks using non-financial test data.
  - Dependencies: Tasks 2, 3, and 5.

- [x] **Task 7 — Building the member coin-purchase experience**
  - Acceptance: members select an agent/package, see currency/price/payment instructions, submit a reference and receipt, and see order state; wallet balance refreshes only after settlement.
  - Verification: focused component/API tests and browser flow with mocked/non-financial data.
  - Dependencies: Tasks 3, 4, and 5.

## Checkpoint: End-to-end flow

- [x] Cross-account authorization and private receipt access are covered by focused tests.
- [x] No real wallet movement is used as a test fixture.
- [ ] Add PostgreSQL integration coverage for concurrent approvals and transactional rollback before production rollout; the current automated tests use a persistence fake for these services.
- [ ] Expand API coverage for authenticated success paths and receipt ownership; current API tests focus on unauthenticated/unauthorized rejection.
- [ ] Complete a mocked/non-financial browser flow through the member purchase entry point; the current local browser check verified the agent login page only.

## Phase 3: Production and real-payment verification

- [x] **Task 8 — Applying the narrow purchase migration in production**
  - Acceptance: read-only preflight confirms expected database and baseline; the reviewed additive migration affects only purchase-related schema, stores a schema signature for reruns, and rejects partial objects or drift; postflight confirms constraints and unchanged existing balances.
  - Verification: migration test first, then approved production migration and read-only schema/balance checks.
  - Dependencies: Tasks 1–7.
  - Result: Applied to `chat_app.public`; all three purchase tables, required constraints, and valid indexes verified. The postflight balance snapshot matched the preflight snapshot; no purchase or settlement was performed.

- [ ] **Task 9 — Verifying one real, externally paid purchase**
  - Acceptance: user identifies a real buyer and agent, configures the package, independently verifies receipt of the actual payment, then approves once; ledger entries reconcile to the request.
  - Verification: inspect only the specific test operation and balances before/after; do not expose credentials or receipt contents.
  - Dependencies: Tasks 1–8 and explicit transaction details/confirmation.

## Checkpoint: Complete

- [x] Full suite (324 tests: 323 passed, 1 skipped) and production build pass. TypeScript and `server/db/migrate.ts` lint still report pre-existing errors outside the edited migration block; the migration script and schema test lint pass.
- [x] Receipt object retention and deletion behavior is implemented and documented (30 days after upload).
- [ ] No unrelated worktree changes are included.
