# Implementation Plan: Wallet Ledger

## Overview

Implement the approved `wallet-ledger` module only. It establishes a source-aware coin ledger, safe migration of existing balances, atomic/idempotent movements, reservations for cash-out, and an authenticated balance view. Gift settlement, agent workflows, benefits, cash-out operations, live gift presentation, and direct payment providers remain separate modules governed by the capability map and their own approved specs.

Spec: [SPEC-wallet-ledger](../../SPEC-wallet-ledger.md)  
Capability map: [CAPABILITY-MAP-gifts-wallet](../../CAPABILITY-MAP-gifts-wallet.md)

## Architecture Decisions

- Keep a single coin denomination in the user experience, but preserve source eligibility in ledger accounts and entries.
- Migrate current coin balances as spendable, non-cashable legacy coins. Do not backfill recipient earnings from historical gift transactions.
- Preserve source eligibility across gift settlement: legacy-funded portions remain non-cashable; newly topped-up and gift-earned portions are cash-out eligible.
- Use immutable operation headers, append-only journal entries, actor-scoped idempotency keys with request fingerprints, and materialized account balances updated in the same PostgreSQL transaction.
- Use server-authenticated identity for financial operations. The client never supplies an authoritative sender ID or balance.
- Do not activate real provider integrations in this module. Direct gateway work waits for merchant documentation.
- The legacy `user_profiles.coins` field is not a post-cutover mirror. A database trigger blocks legacy writes after the opening operation commits, and balance reads use ledger accounts.
- Auto-migrations create wallet schema only. The explicit legacy opening transaction takes a table lock and commits its marker, accounts, entries, and balances together; wallet writes fail closed until that marker exists.
- Generic admin database mutation endpoints must reject wallet tables.
- Full reversals are one-time and rejected for manual review if the receiver has already spent the amount; no negative balance/debt is created.
- **Database-change gate:** the user approved the concrete schema and cutover design. Do not execute the opening migration against production/shared data; migration tests may use only an isolated database.

## Dependency Graph

```text
Ledger schema and guarded one-time legacy cutover
                  │
                  ▼
       Atomic source-aware ledger service
          ┌───────┴────────┐
          ▼                ▼
   Holds/reversals    Gift-send cutover
          └───────┬────────┘
                  ▼
      Authenticated wallet summary
                  │
                  ▼
          Final verification
```

## Task List

### Phase 1: Ledger foundation

- [ ] Task 1: Add source-aware ledger schema, invariants, and append-only guards.
- [ ] Task 2: Add the explicit atomic legacy opening migration and fence legacy writes/admin mutations.
- [ ] Task 3: Implement atomic, source-preserving, idempotent coin movements.
- [ ] Task 4: Add balance reservation, release, settlement, and full-reversal primitives.

### Checkpoint: Ledger foundation

- [ ] Migration can be rerun without duplicating opening balances.
- [ ] Unit tests prove no negative balance, duplicate posting, or source-eligibility escalation.
- [ ] Opening marker, entries, and account balances commit or roll back together.
- [ ] Legacy coin writes fail after cutover, and generic admin endpoints cannot mutate wallet tables.
- [ ] No migration was executed against production or shared live data.

### Phase 2: Existing gift flow and wallet read path

- [ ] Task 5: Move existing gift sending to authenticated, source-aware ledger posting.
- [ ] Task 6: Add an authenticated wallet summary and move coin reads to ledger-backed balances.

### Checkpoint: Wallet flow

- [ ] A registered member can send a gift using the server-authoritative balance.
- [ ] Guests and forged client sender IDs cannot initiate financial operations.
- [ ] The user can distinguish total spendable coins from cash-out-eligible coins.

### Phase 3: Final verification

- [ ] Task 7: Run project tests, build, lint, and migration review.

### Checkpoint: Complete

- [ ] All wallet-ledger success criteria in the approved spec are met.
- [ ] No gateway, agent, cash-out workflow, or benefit-store scope was implemented without its own approved spec.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy balance is credited more than once by a repeated migration | High | Use a unique opening-entry reference and test migration reruns. |
| Concurrent sends overspend a wallet | High | Lock or conditionally update the exact source buckets in a single transaction; test concurrent debits. |
| A legacy coin becomes cashable through gifting | High | Preserve source portions on every debit/credit and assert eligibility invariants. |
| Client-supplied identity or amount is trusted | High | Derive actor from the verified auth token; calculate prices and fees on the server. |
| A pending cash-out is spent again | High | Reserve the amount atomically and release/settle exactly once. |
| Financial rules are altered after a transaction | Medium | Snapshot rates and fees in the transaction record. |
| Production or shared database is changed during testing | High | Require explicit schema approval and use an isolated test database only. |

## Open Questions

- Confirm local legal/identity requirements before enabling live cash-out in production.
- Configure initial YER/foreign-exchange rates, commissions, limits, and dispute window before enabling transactions.

## Task List Target

Tasks are tracked in [tasks/gifts-wallet/todo.md](./todo.md), separate from the active `provider-admin` plan.
