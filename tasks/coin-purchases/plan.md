# Implementation Plan: Coin Purchases Through Agents

## Overview

Build a real, manually verified purchase flow on top of the existing wallet ledger. A site owner first quotes and approves agent inventory purchases from site inventory. Each agent then configures coin packages, a three-letter fiat currency code, and payment instructions. A registered member submits a purchase request with a transaction reference and private receipt image; only that selected active agent can approve it and atomically transfer the quoted coins from agent inventory to the member's cashable wallet.

This plan is separate from the active `provider-admin` plan in `tasks/plan.md`. Tasks are tracked in this folder. No direct payment gateway is included. The approved production schema migration was applied only after focused tests, migration review, and a read-only preflight. A live purchase test requires a real agent, member, configured package, and externally verified payment; no test transaction will be fabricated.

## Architecture Decisions

- Extend the existing append-only wallet ledger to represent agent inventory accounts and agent-authored financial operations. Keep site, agent, and member movements balanced and atomic.
- Use immutable purchase requests with idempotent settlement. Snapshot the selected package, currency, price, and payment instructions at request time so later price edits cannot change an open purchase.
- Require the site owner to verify an agent's external payment before moving site inventory into agent inventory. Require the selected agent to verify a member's external payment before moving agent inventory into the member's cashable balance.
- Treat payment references and receipt images as private financial data. Validate upload type and size, store objects privately, expose them only to the involved member and authorized reviewer, and implement an explicit retention/deletion policy.
- Agent-set retail prices do not change balances or settle a purchase by themselves. Store fiat amounts in integer minor units with an ISO-style three-letter currency code; do not infer exchange rates.
- Keep authorization server-side and derive members and agents from their verified sessions. Use database constraints, transactions, request fingerprints, and unique idempotency keys to prevent duplicate or unauthorized credits.
- Do not add a direct payment provider or store card credentials. All money transfers remain external and are manually verified.

## Dependency Graph

```text
Agent inventory ledger accounts + additive production schema
                 │
        ┌────────┴─────────┐
        ▼                  ▼
Site owner approves    Agent configures
agent stock purchases  retail packages/payment instructions
        │                  │
        └────────┬─────────┘
                 ▼
Member submits a private, priced purchase request and receipt
                 │
                 ▼
Selected agent verifies payment and atomically settles to member
                 │
                 ▼
Member wallet/gift UI, audit, retention, and production verification
```

## Task List

### Phase 1: Ledger and purchase contracts

- [x] Task 1: Add agent inventory accounts and purchase request schema with additive, idempotent migrations.
- [x] Task 2: Implement atomic site-to-agent stock requests, owner verification, and ledger settlement.
- [x] Task 3: Implement agent package, currency, and payment-instruction management with immutable request snapshots.

### Checkpoint: Inventory and pricing

- [x] Focused schema, migration, authorization, idempotency, and ledger tests pass.
- [x] No inventory is created from nothing; owner approval cannot overdraw site inventory.
- [x] Agent settings affect only that agent and cannot settle or credit any wallet.

### Phase 2: Member purchases

- [x] Task 4: Add private receipt storage, member purchase submission, and authenticated order/status APIs.
- [x] Task 5: Add selected-agent review and atomic, idempotent agent-to-member settlement.
- [x] Task 6: Add agent and site-owner interfaces for inventory/payment review and agent settings.
- [x] Task 7: Add the member purchase entry point, package selection, receipt upload, status, and balance refresh.

### Checkpoint: End-to-end flow

- [x] Only the selected active agent can approve a member purchase; unrelated agents and members are denied.
- [x] Settlement locks and idempotency constraints prevent duplicate credits and negative agent inventory; retry and insufficient-inventory behavior have focused service tests.
- [x] Receipt objects are private, validated, inaccessible to unrelated accounts, and removed after the approved 30-day object-retention period.
- [x] Member UI shows the exact currency, amount, package, payee instructions, proof requirement, and pending/approved/rejected status.

The browser check used an isolated local server with dummy database and object-store endpoints. It verified the agent login page renders; it did not authenticate an agent or simulate a purchase. Parallel database settlement behavior is enforced by PostgreSQL row locks and unique constraints, but has not been exercised against a live database.

### Phase 3: Production and real-payment verification

- [x] Task 8: Apply only the reviewed purchase schema migration to the approved production database after a read-only preflight. The migration records a schema signature and rejects partial objects or drift on reruns.
- [ ] Task 9: Verify the deployed purchase flow and perform a real purchase only after the user identifies the buyer and agent and confirms an actual payment has been externally verified.

### Checkpoint: Complete

- [ ] Focused tests, full test suite, TypeScript, build, and changed-file lint pass. The latest suite ran 324 tests (323 passed, 1 skipped), and the production build passed. TypeScript and `server/db/migrate.ts` lint still report pre-existing errors outside the edited migration block; the migration script and schema test lint passed.
- [ ] Production balances reconcile to ledger entries; no synthetic balance or fake payment was introduced.
- [ ] Production transaction test is traceable to a real externally verified payment and its receipt.
- [ ] Operational documentation describes review, disputes, and proof retention.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| An agent approves a request without actually receiving money | High | Manual verification is explicit; record reviewer, reference, immutable snapshot, and audit event. |
| A retry or race settles the same request twice | Critical | Lock the request and ledger accounts in one transaction; enforce unique operation/idempotency references. |
| Agent inventory is credited without a corresponding site debit | Critical | Balanced journal postings, nonnegative account constraints, and atomic owner approval. |
| A receipt leaks to another member or becomes publicly addressable | High | Private object storage and authorization on every receipt read; never persist public URLs. |
| An agent changes a price after a member submits a request | High | Store immutable package/price/currency/payment-instruction snapshots on the request. |
| A production migration affects unrelated data | High | Apply a narrow, additive migration only after a read-only schema preflight; never run the broad startup migration for this rollout. |
| A real-world purchase test creates a financial dispute | High | Do not initiate or settle any real test order until buyer, agent, amount, and external payment verification are explicitly confirmed. |

## Retention and remaining operational decisions

- Receipt image objects expire 30 days after upload. The private receipt endpoint also denies access after the recorded expiry; bucket lifecycle performs object deletion.
- The database purchase/order rows and payment-reference metadata are not deleted by the object-store lifecycle. Define their retention and deletion policy before accepting real purchases.
- A production test account, a specific agent, a package/price, and a matching externally verified payment must be identified before the real test transaction.

## Files Likely to Change

- `server/db/schema.ts`, `server/db/migrate.ts`
- `server/services/coinLedgerService.ts` and focused purchase/inventory services
- `server/routes/api/agents/`, `server/routes/api/site-owner/`, `server/routes/api/wallet/`
- `src/pages/AgentPortal.tsx`, site-owner wallet UI, member wallet/gift entry point
- `tests/` focused schema, service, API, upload, and end-to-end coverage
- `CAPABILITY-MAP-gifts-wallet.md` and purchase operations documentation
