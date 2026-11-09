# Implementation Plan: Site Wallet Funding

## Overview

Implement the first funding module from the approved capability map: a private hosting-owner portal that credits the site's single coin-inventory account after a manually verified external payment. Later modules will use that stock to fund agents and member top-ups; those flows are not part of this plan.

Spec: [Site Wallet Funding](../../SPEC-site-wallet-funding.md)  
Capability map: [Gifts, Wallet Funding, and Cash-out](../../CAPABILITY-MAP-gifts-wallet.md)

The in-progress `provider-admin` plan at `tasks/plan.md` is not modified. Tasks and this plan are kept in this feature-specific folder.

## Architecture Decisions

- Extend the existing wallet ledger with one `system:site_inventory` bucket and a non-negative balance constraint. Continue using the existing `system:external_clearing` account as the balancing external-funding entry.
- Keep `wallet_operations.actor_scope` as `system`; record the configured hosting-owner identifier in immutable metadata rather than broadening the actor model or storing credentials.
- Enforce both system-scoped idempotency and uniqueness of the normalized external payment reference for site-funding operations.
- Idempotently provision zero-balance `site_inventory` and `external_clearing` account rows in the schema migration; reject missing account state without creating an opening balance during funding.
- Store only environment-variable names and placeholders in `.env.example`. The configured portal key, username, password hash, and production `AUTH_SECRET` remain private deployment settings.
- Use a separate hosting-owner session type and cookie; the secret route key only hides the portal and is never sufficient authorization.
- Do not seed an initial inventory balance. Approval to roll out the schema does not authorize legacy wallet backfills or funding transactions.

## Dependency Graph

```text
Site inventory schema and migration
                 │
       ┌─────────┴────────────┐
       ▼                      ▼
Portal path/config      Hosting-owner auth
       └─────────┬────────────┘
                 ▼
      Atomic funding service/API
                 │
                 ▼
       Hosting-owner portal UI
                 │
                 ▼
          Final verification
```

## Task List

### Phase 1: Ledger and portal foundations

- [x] Task 1: Extend the ledger schema for site inventory.
- [x] Task 2: Add the private hosting-owner portal path and configuration.
- [x] Task 3: Add hosting-owner credential verification and scoped sessions.
- [x] Task 4: Isolate hosting-owner sessions from generic member/admin endpoints.
- [x] Task 5: Add protected authentication endpoints and rate limiting.

### Checkpoint: Foundations

- [x] Schema tests prove one site-inventory bucket, non-negative inventory, and unique funding references.
- [x] Portal access fails closed when configuration is absent or invalid.
- [x] Hosting-owner sessions cannot be used as member, agent, or ordinary admin sessions.

### Phase 2: Funding transaction

- [x] Task 6: Implement idempotent external funding with balanced ledger postings.
- [x] Task 7: Add the hosting-owner funding screen.

### Checkpoint: Funding flow

- [x] An authorized hosting owner can record one externally funded coin credit with an audit reference.
- [x] A duplicate request or reused payment reference cannot credit the site twice.
- [x] A failed ledger write leaves no partial operation or balance change.

### Phase 3: Verification and production schema rollout

- [x] Task 8: Run focused wallet migration tests and apply only the wallet/site-funding schema to the confirmed production database in one transaction. Do not run the legacy balance backfill.
- [ ] Task 9: Resolve the known unrelated full-suite import failure and complete full verification.
- [ ] Task 10: Configure and verify the hosting-owner portal secrets in the actual production runtime; do not put production values in `.env` or source control.

### Checkpoint: Complete

- [ ] All site-wallet-funding acceptance criteria pass.
- [ ] No changes were made to the in-progress `provider-admin` plan or unrelated worktree changes.
- [x] Only the approved wallet schema was changed in production; existing legacy opening data was preserved, both new system accounts have zero balances, and no funding transaction was created.
- [ ] Production runtime secrets are configured and the hosting-owner portal is reachable.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| An external payment reference is submitted twice with different idempotency keys | High | Normalize the reference and enforce partial unique indexing for this operation type. |
| A hidden URL is mistaken for authentication | High | Require a credential-backed, signed hosting-owner session on every protected endpoint. |
| A failure creates unbalanced or partial funding | High | Lock both accounts deterministically and commit operation, entries, and balance updates in one transaction. |
| A system wallet migration weakens member-balance constraints | High | Add focused schema/migration tests and retain all existing member/system bucket checks. |
| A schema rollout accidentally performs a legacy backfill or funds the site | High | Apply only the schema function in an explicit transaction; keep legacy backfill and funding as separate, independently approved operations. |
| Portal secrets leak into source or browser output | High | Read them only from server environment, validate at startup/request boundaries, and never return or log them. |

## Out of Scope

- Agent stock purchase orders, owner-set agent quotes, and agent payment-proof review.
- Member top-up requests paid to agents and agent approval/rejection.
- Agent/site payment-method management, funding reports, gift flows, cash-out, and payment-provider integrations.
- Choosing legal retention periods for production payment records.

These are separate capabilities in the approved map and need their own module specifications after this module is complete.
