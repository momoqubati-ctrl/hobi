# Hobi — Ephemeral Private Messaging Report

## Executive Summary

Private messages are now served from a bounded process-memory store, bound to authenticated token sessions, and no longer read from or written to `private_messages` by the application code. Socket delivery is addressed to server-derived session rooms; REST fallback uses the same in-memory store and message idempotency key. Message filtering no longer writes PM text to `histletter` or broadcasts it to moderators.

On the verified local database, 20 existing PM rows were deleted after a sanitized backup was restored and checked. A PostgreSQL trigger now rejects future inserts and updates to `private_messages`. No deployment or production verification was performed.

**Final status: PARTIAL.** Historical PM media files and earlier backups may still contain PM data and could not be safely identified or altered.

## Implementation

- The in-memory store binds conversations to authenticated sessions, requires an online authenticated recipient, limits retained messages, deduplicates retries, and deletes a conversation when either bound session logs out or expires.
- The production feature is disabled by default. `PM_EPHEMERAL_SINGLE_PROCESS=true` is required to enable it in production, and any configured `SOCKET_SHARD_ID` disables it. The deployment topology was not verified, so the production opt-in must not be set until single-process operation is independently established.
- PM REST and Socket paths use the same store. Socket delivery uses server-generated session rooms; clients cannot choose the delivery room or sender identity.
- Logout derives identity from the verified token, not request-body `userId`, and ends only that token session. Other token sessions for the same account are not intentionally logged out.
- PM attachment uploads return HTTP 410; Socket media payloads are rejected. The UI hides image, sticker, and voice-message actions. Text, emoji, animated text effects, and YouTube links remain available.
- PM text processing suppresses persistent filter logs and moderator alerts.
- The database table remains for compatibility, but `private_messages_ephemeral_only` rejects `INSERT` and `UPDATE`. Its reversible migration helpers were exercised against the isolated restore.

## Database Impact and Reconciliation

Target identity was checked twice through the connection used by `server/db/index.ts`:

| Item | Result |
|---|---:|
| Database | `chat_app` |
| Server | `127.0.0.1:5432` |
| PostgreSQL | `18.4` |
| Users preserved | `17` |
| Internal mail preserved | `21` |
| Existing PM rows deleted | `20` |
| PM filter-log rows found/deleted | `0` / `0` |
| PM notification rows before/after | `0` / `0` |
| PM rows after deletion | `0` |
| Storage-blocking trigger | Installed and verified |

The trigger and deletion ran in one transaction on the verified local target. The schema remains intact; internal mail and account records were not modified. No message bodies or personal message content were queried or shown.

## Sanitized Backup Evidence

Backup directory: `D:\medo\hobi-backups-unencrypted\20261105T181635Z_ephemeral-pm\`

| File | Size | SHA-256 |
|---|---:|---|
| `chat_app_sanitized.dump` | 788,355 bytes | `CA09B83E9B766853CB43A663F07A0290B9F99F5D65BA5EAA3E1E1A320FCC69F5` |
| `globals.sql` | 1,059 bytes | `64225F83EE05499D8F147BC56B7553ABA1BA69BE9CB34657628B9E88EEA399D9` |

- `pg_dump` Custom archive with Large Objects and `pg_dumpall --globals-only` both completed successfully using PostgreSQL 18.4 utilities.
- The sanitized archive excludes all `private_messages` and `histletter` table data; their schemas remain. `pg_restore --list` passed with 526 entries and no data entries for either table.
- A restore to `hobi_pm_sanitized_verify_20261105_181635` succeeded. Restored users and internal mail counts matched the source (`17` and `21`); PM and filter-log counts were zero. The test database was dropped after verification. Globals were not applied to avoid server-wide role changes.
- The backup folder and files have ACL access only for the current Windows account, `SYSTEM`, and `Administrators`. No file has the EFS `Encrypted` attribute; the parent reports that new files are not EFS-encrypted. No archive password or file-level encryption was used.
- Volume-level BitLocker status was not checked during this task.
- The external `backup-manifest.md` records the same verification details.

## Validation

- Isolated PM store, topology-gating, and PM text-filter tests: **7 passed, 0 failed**.
- Synthetic storage-trigger up/down test on the restored database: **passed**; synthetic inserts were rolled back and the table remained empty.
- `npm run build`: **passed**.
- `tsc --noEmit -p tsconfig.app.json`: **failed** on unrelated workspace diagnostics in admin, call, room, selector, settings, profile, and library files. After aligning PM reply-media types, there were no remaining diagnostics in `PrivateChat.tsx`.
- `tsc --noEmit -p tsconfig.node.json`: **failed** on workspace diagnostics in schema/auth/filter/presence/Vite code; no diagnostic was reported in the new ephemeral store, logout route, or PM migration helper. No clean pre-change typecheck baseline was available.
- No live-user PM flow, production Socket topology, production database, or deployment was tested.

## Remaining Limitations

1. Existing PM media used the same `wall` upload storage convention as legitimate wall files. Those files cannot be distinguished safely from the observed metadata and were not deleted.
2. The previously existing backups were left untouched. They may retain PM data; this report does not claim deletion from historical backups.
3. Process-memory conversations are intentionally not shared across instances. Production remains disabled unless an operator explicitly asserts single-process topology; that topology remains unverified.
4. No production safety conclusion is made from the static review or local verification.

## Final State

```text
CURRENT_DATABASE_USED: YES — chat_app at 127.0.0.1:5432
SANITIZED_BACKUP_CREATED: YES
DATABASE_DUMP_AND_RESTORE_VERIFIED: YES
GLOBALS_DUMP_VERIFIED: YES — dump completed; globals were not restored
OLD_PM_ROWS_DELETED: YES — 20
PM_STORAGE_GUARD_INSTALLED: YES
INTERNAL_MAIL_AND_USERS_PRESERVED: YES — 21 mail rows, 17 users
EFS_ENCRYPTION: NONE on backup directory/files
ARCHIVE_PASSWORD: NONE
PRODUCTION_STATUS: UNVERIFIED
DEPLOYMENT: NONE
FINAL_STATUS: PARTIAL — historical media and earlier backups may retain PM data
```
