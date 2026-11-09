# Capability Map: Site Owner Identity and Wallet

| Module id | Responsibility | Depends on |
|---|---|---|
| `site-owner-bootstrap` | Idempotently create the distinct “مالك الموقع” member from configured bootstrap credentials, assign a dedicated application-only permission group, and protect that group from edits and deletion. Keep it separate from the hosting-owner account `safarihost` and its `__system_owner__` role. | — |
| `site-wallet-access` | Associate the site inventory wallet with the site-owner member and enforce wallet visibility at the API boundary. Both the site-owner member and the separately authenticated hosting owner may view the wallet, as explicitly confirmed; do not convert the system wallet into a member wallet or create an opening balance. | `site-owner-bootstrap`, `site-wallet-funding` |

Build order: `site-owner-bootstrap` → `site-wallet-access`.

## Confirmed product decisions

- The site owner is a separate application member, not the hosting-owner account `safarihost`.
- Bootstrap credentials are supplied through private environment variables as a username and password hash; no plaintext password or default credential is stored.
- The dedicated group receives all application permissions defined by the permission engine, except the hosting-owner portal permission/window. It does not receive hosting-owner identity or portal authority.
- The site-owner group is protected from modification and deletion through application APIs and the database boundary.
- The wallet remains the single system `site_inventory` ledger account. Both owners may view its balance and history; the hosting owner continues to use the separate authenticated funding portal.
- Repeated installation/startup must not duplicate the owner, role, assignments, or wallet association, and must not overwrite existing credentials or create a funded balance.
- Applying this capability does not authorize running the legacy wallet backfill or recording a funding transaction.

## Review gate

Approve or revise this capability map before writing module specifications or implementation plans.
