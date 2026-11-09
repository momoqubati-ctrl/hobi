# Spec: Wallet Ledger

## Objective

Create the authoritative accounting layer for the site's coin economy. Users see one coin denomination, while the ledger retains each coin lot's origin and cash-out eligibility. The ledger must support top-ups, gifts, site-benefit purchases, and cash-outs without allowing duplicated credits, negative balances, or spending the same coins twice.

## Tech Stack

- React 19.2.3 and TypeScript 5.5.x
- Nitro 3.0.260429-beta with H3 2.0.1-rc.22 API routes
- PostgreSQL with `pg` 8.20.x and Drizzle ORM 0.45.x
- Node.js runtime; no exact runtime version is pinned in `package.json`

## Commands

- Tests: `npm test`
- Build: `npm run build`
- Lint: `npm run lint`
- Wallet schema: idempotent server-startup migration
- Legacy wallet opening: set `WALLET_BACKFILL_CONFIRM` to `legacy-opening-v1`, then run `npm run db:wallet-backfill`
- Distributed social schema (separate): `npm run db:migrate`

## Project Structure

- `server/services/` — wallet ledger and transaction services
- `server/db/schema.ts` — typed database schema
- `server/db/migrate.ts` — idempotent PostgreSQL schema migrations
- `server/db/walletBackfill.ts` — explicit one-time legacy wallet opening migration
- `server/routes/api/` — authenticated H3 endpoints for wallet operations
- `src/components/` — wallet, gifting, and benefit purchase interfaces in later modules
- `tests/` — TypeScript tests loaded by `scripts/run-tests.mjs`

## Code Style

Follow existing TypeScript service patterns and parameterized PostgreSQL queries. Money-changing operations use a database transaction and always release the checked-out client:

```ts
const client = await dbPool.connect();
try {
  await client.query("BEGIN");
  // Validate and record all related ledger entries atomically.
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

Use integer coin units, explicit transaction types, validated input, and structured errors. Do not use client-supplied user IDs as the authority for a financial operation.

## Scope and Rules

- Keep one coin denomination in the user experience, but maintain source-aware ledger accounts internally.
- Use `wallet_operations` for operation headers, `wallet_balances` for materialized member/system accounts, and `wallet_entries` for immutable signed postings.
- Member account buckets are `legacy_spendable`, `cashable_spendable`, and `cashable_reserved`; system accounts track platform fees, external clearing, and opening-balance equity. Constraints reject invalid account/bucket combinations and negative member balances.
- Posting locks all affected accounts in deterministic order, validates allowed source-to-destination movements, and writes entries plus balance changes atomically. Idempotency keys are actor-scoped; reusing a key with a different canonical request fingerprint is a conflict.
- New approved top-ups and new gift credits are eligible for cash-out, subject to the configured coin/YER conversion rate, commissions, fees, and limits.
- Existing `user_profiles.coins` balances migrate as spendable but non-cashable legacy coins. Historical gift transactions do not create retroactive earnings.
- Spending legacy coins on a gift preserves their source: the recipient receives a non-cashable net credit for the legacy-funded portion. A gift funded from cashable coins produces a cashable net credit.
- When both sources are available, gifts spend legacy coins first. For mixed-source gifts, the percentage fee is allocated proportionally to source amounts, with the integer rounding remainder assigned to the cashable portion.
- If a transaction uses multiple coin sources, record the source amounts and resulting recipient credits separately. The total debit must equal recipient credits plus platform commission.
- Gift commission is a percentage deducted from the listed gift price. It is configured in a dedicated finance section of the admin control panel, stored in basis points, and rounded down to whole coins. There is no implicit default: ledger-backed gift sends remain disabled until a valid rate is configured, and the effective rate and fee are retained with each operation.
- The displayed wallet reports both total spendable coins and coins currently eligible for cash-out.
- A gift, benefit purchase, or cash-out must reserve/debit its source balance atomically. A pending cash-out holds coins until it is paid, rejected, or cancelled.
- Operations and entries are append-only; corrections use linked entries and never edit or delete original financial history. User deletion may null an operation's actor reference without changing its system/member scope or financial fields.
- Reversals are full-entry and one-time. If the recipient has already spent the amount, an automatic reversal is rejected for manual review; the ledger does not create debt.
- Concurrent transactions cannot overspend any source balance. All balances and journal entries are updated in one database transaction.
- Platform fees, exchange rates, and agent fees are applied from the values effective when the operation is accepted and are retained as transaction snapshots.
- Wallet policy settings are stored in the dedicated `wallet_settings` table, protected from the generic admin database editor, and updates are permission-checked and audited.
- Server-startup auto-migrations create the wallet schema only. Startup also detects and additively restores the `wallet_operations.metadata` column on older existing schemas without running the full migration or changing wallet balances. The one-time legacy opening operation is run separately, under a table lock, with its operation marker, entries, and balance updates in one transaction. Wallet mutations fail closed until that marker commits.
- After cutover, a database trigger rejects writes to `user_profiles.coins`. Application balance reads use the ledger; the legacy field is not a balance mirror. Generic admin database mutation endpoints must reject wallet tables.
- Financial routes require a valid authenticated member or the specific agent/admin permission. Guests cannot charge, gift, buy benefits, or cash out. A user ID in the request body is never proof of identity.
- Level/upgrade-based eligibility is extensible per operation but is not enforced at initial launch.
- Bank-transfer and agent operations are in the first phase. Direct electronic-wallet/payment-gateway integration is deferred until the user supplies merchant documentation.
- Initial cash-out is manual through an authorized agent or administrator, with a recorded payout reference/proof and a configurable dispute path. Member confirmation is not required.

## Testing Strategy

Use the repository's Node.js `node:test` style and run tests through `npm test`. Add focused service tests for:

- source-specific balance and cash-out eligibility, including legacy-funded gifts;
- fee arithmetic and conservation of value across sender debit, recipient credit, and platform commission;
- concurrent debits, insufficient funds, and prevention of negative balances;
- idempotent top-up/gift/cash-out posting, changed-payload key reuse rejection, and linked full reversals;
- cash-out reservation, rejection/cancellation release, and completion;
- migration reruns preserving balances without backfilling historical gift earnings;
- legacy coin writes being rejected after cutover and admin generic writes being blocked for wallet tables.

Run the production build and lint after the implementation slice. Do not weaken existing assertions or skip unrelated tests.

## Boundaries

- Always: authenticate on the server; validate integer amounts and configured rates; lock/update balances atomically; preserve source and audit history; fail closed if rates, fees, or permissions are invalid.
- Ask first: changing whether legacy or topped-up balances can be withdrawn; changing commission payer or conversion semantics; enabling a payment provider; changing currency/rounding rules; deleting or rewriting financial history.
- Never: trust client-calculated prices, accept a client balance as authoritative, credit a wallet from an uploaded receipt alone, expose private transfer proof publicly, or commit payment credentials.

## Success Criteria

- Two concurrent spends cannot cause a source balance to go below zero.
- Retrying the same operation never changes any balance more than once.
- For each gift transaction, sender debit equals recipient net credit plus platform commission, with source eligibility preserved.
- No historical gift creates a new recipient credit during migration.
- Post-cutover movements and reversals are auditable; pre-cutover balances are represented by opening entries, while existing `gift_transactions` remain unchanged.
- Legacy coins remain spendable but never become cashable through gifting.
- A pending cash-out cannot also be spent on gifts or benefits; rejection/cancellation restores the held amount exactly once.
- Users can distinguish total spendable coins from the amount available for cash-out.
- Financial operations fail for guests and when rates/fees or authorizations are missing or invalid.

## Open Questions

- Which age, identity-verification, and regulatory requirements apply to cashing out in the operating jurisdiction? Manual cash-out is a product requirement, but production payout rules need local review.
- What are the initial coin/YER rate, foreign-exchange rates, fee values, limits, and dispute window? These must be configured by administrators before operations are enabled; no monetary defaults should be guessed.

## Reference

The official TikTok Virtual Items Policy documents a comparable separation between sender Coins and recipient Diamonds, with distinct withdrawal rules. This project intentionally allows its coin balance to be spent on site benefits and gifts as well as cashed out, so the policy is a product-pattern reference only and not a legal or implementation template: <https://www.tiktok.com/legal/page/global/virtual-items-policy/en>.
