# Capability Map: Gifts, Wallet Funding, and Cash-out

| Module id | Responsibility | Depends on |
|---|---|---|
| `wallet-ledger` | Authoritative ledger for the single user-facing coin balance, preserving each balance movement's source and preventing duplicate or conflicting spends | — |
| `pricing-rules` | Configurable coin-to-YER and foreign-exchange rates, gift commissions, withdrawal fees, agent commissions, and price snapshots | `wallet-ledger` |
| `site-wallet-funding` | One site inventory account funded manually by the hosting owner after external payment; private hosting-owner portal, immutable funding entries, and audit history | `wallet-ledger` |
| `agent-inventory` | Agent stock purchase requests, owner-set quotes, private payment proof, owner approval/rejection, and atomic site-to-agent inventory transfers | `site-wallet-funding`, `pricing-rules` |
| `funding-and-agents` | Member top-up requests paid to an agent, private proof review, agent approval/rejection, and atomic agent-to-member settlement | `wallet-ledger`, `pricing-rules`, `agent-inventory` |
| `agent-coin-purchases` | Agent-managed coin packages and payment instructions; immutable member purchase snapshots, private receipt review by the selected agent, and atomic agent-to-member settlement | `wallet-ledger`, `agent-inventory` |
| `funding-reporting` | Reconciliation views for site/agent balances, funding and top-up requests, settlements, and audit history | `site-wallet-funding`, `agent-inventory`, `funding-and-agents` |
| `gift-settlement` | Atomic gift debit, recipient coin credit after platform commission, and transaction-source recording | `wallet-ledger`, `pricing-rules` |
| `benefit-redemption` | Admin-managed catalog of site benefits/upgrades, allowed coin sources, pricing, duration, and atomic purchase/entitlement records | `wallet-ledger`, `pricing-rules` |
| `cashout` | Withdrawal requests, reserved coins, fees, review, dispute handling, and payout recording by the platform or an agent | `wallet-ledger`, `pricing-rules`, `funding-and-agents` |
| `gift-experience` | Gift entry points and delivery across rooms, private chat, profiles, walls, and posts, including room-wide full-screen events and recipient-only notifications elsewhere | `gift-settlement` |

Build order: `wallet-ledger` → `pricing-rules` → (`site-wallet-funding` → `agent-inventory` → (`funding-and-agents`, `agent-coin-purchases`) → `funding-reporting`; `gift-settlement` → `gift-experience`; `benefit-redemption`); `cashout` follows `funding-and-agents` and `pricing-rules`.

## Approved product decisions

- The base currency is Yemeni rial (YER); exchange rates are configurable.
- A single coin balance is shown to users; the ledger still preserves source and transaction history.
- Newly topped-up coins and coins received from new gifts are eligible for cash-out, subject to configurable conversion rates, fees, and controls.
- Existing legacy coin balances remain spendable but are not cash-out eligible; no gift earnings are backfilled from historical gift transactions.
- If a gift is funded from legacy non-cashable coins, the recipient's corresponding net credit remains non-cashable. Source eligibility is preserved through each gift.
- Gift commission is deducted before coins are credited to the recipient.
- Gift-earned coins can be spent on eligible site benefits/upgrades, sent as gifts, or cashed out; the same balance is reserved/consumed atomically when buying, gifting, or cashing out.
- Every operation must show the total spendable coin balance and the amount currently eligible for cash-out.
- Agent accounts are configured by administrators; recharge and cash-out permissions are distinct and may be assigned to the same agent. Agent top-up requests are verified by the selected agent and are available for administrative audit.
- The site has one coin-inventory account. The hosting owner funds it through a separately authenticated portal after an external payment; this is an audited external clearing entry, not a transfer from an in-system hosting-owner wallet.
- The hosting portal's path is supplied only through deployment environment configuration. A secret path is not authentication: portal actions also require a dedicated login and secure session.
- The site owner sets each agent stock-purchase price. An agent's transfer notice does not move coins; only the site's owner can approve it and atomically transfer the quoted coin amount from site inventory to that agent.
- An agent's member top-up is settled only after the agent reviews the payment proof; settlement atomically debits agent inventory and credits the member's cash-out-eligible balance.
- Coin purchases use manually verified external payments, agent-configured packages, and immutable snapshots of the price, currency, and payment instructions. Only the selected active agent may settle a member's submitted purchase.
- Private receipt image objects expire 30 days after upload and are removed by object-store lifecycle rules. Purchase and payment-reference database records are separate and need their own retention policy before real transactions are accepted.
- Cash-out can be recorded complete by an agent or administrator with an optional dispute path; member confirmation is not required.
- Eligibility rules can later be configured per operation and member level; only registered members may use financial operations initially.
- Direct payment-gateway integration is deferred until the provider's merchant documentation is supplied. The first design should allow providers to be added behind an adapter.
