# HOBI PREVIOUS TEST DATABASE WRITE INCIDENT POSTMORTEM

**Evidence-first forensic review | Backup before inspection | No repair authorized**  
**Project:** Hobi  
**Repository:** `D:\medo\hobi`  
**Database used:** `chat_app` on local PostgreSQL  
**Final incident finding:** `UNKNOWN`

## 1. Executive Summary

A prior test was not isolated from the application database. The test passes a fake database as a fifth argument to `getMessages`, but the current service function accepts only four arguments and uses the imported `dbPool` directly. The extra argument is ignored at runtime. The service therefore reaches the configured project database instead of the fake.

The earlier run evidence retained in the session summary indicates it reached the `UPDATE private_messages` path. Its command tag/row count was not retained, and the test was stopped. This task did not rerun the test or write to the database.

Before any forensic query, a custom-format database backup and a separate globals dump were created and validated. After that gate, read-only queries confirmed:

- The current database has no user-key match for `observer-id`.
- No current row matches the synthetic `conversation_id = 'member-a:member-b'`; the resolver-adjusted update condition also matches zero current rows.
- PostgreSQL logging is not configured to record successful statements (`log_statement=none`; duration logging disabled). `pg_stat_statements` and `pgaudit` were not available as installed extensions. Available PostgreSQL log files contained no matching UPDATE/sentinel entries, but this absence is not evidence that a successful update did not occur.

**Conclusion:** the current snapshot shows no matching synthetic conversation/message rows, but it cannot establish the pre-test state or whether an earlier update affected rows that were subsequently changed or removed. The prior update outcome remains **`UNKNOWN`**, not `NOT_OCCURRED`.

## 2. Current Database Identity

| Item | Evidence |
|---|---|
| Driver / engine | Project code creates a PostgreSQL `pg.Pool` from `DATABASE_URL` in [server/db/index.ts](./server/db/index.ts#L1); live read-only identity query returned PostgreSQL `18.4`, x86_64 Windows |
| Database | `chat_app` |
| Host / port | `127.0.0.1:5432` |
| Configuration source | `.env` `DATABASE_URL` was selected by the backup and forensic processes; the project calls `dotenv.config()` in [server/db/index.ts](./server/db/index.ts#L1) |
| Local service evidence | PostgreSQL process was listening on port 5432; the database identity query returned server address `127.0.0.1/32` |
| Production status | **UNVERIFIED**. A local database endpoint and project `.env` do not establish whether its data is development, staging, or a copy of production |
| Credentials | Not included in this report or manifest |

The backup/forensic process selected the same `.env` URL used by the project code under the current shell environment, falling back only if the variable is absent. This does not prove that a separately running application process had no process-level environment override.

## 3. Backup Procedure

The project connection configuration was identified without printing credentials. PostgreSQL utilities were available locally; no tools or packages were installed.

Before opening a diagnostic database session:

1. Created a unique backup directory outside the repository.
2. Removed inherited broad access on the backup root and child directory. Explicit full control is limited to the current Windows account, `SYSTEM`, and local Administrators.
3. Marked the directory for EFS encryption.
4. Ran `pg_dump` 18.4 with custom archive format and `--blobs`, without schema/table exclusions.
5. Ran `pg_dumpall --globals-only` for roles and tablespaces.
6. Verified archive readability with `pg_restore --list`, file sizes, SHA-256 hashes, encryption attributes, and ACLs.

No database DML, DDL, migration, test, or repair operation was run.

## 4. Backup Verification Evidence

**Backup classification:** `BACKUP_CREATED_ARCHIVE_VALIDATED_NOT_RESTORE_TESTED`

| File | Size | SHA-256 | Verification |
|---|---:|---|---|
| `D:\medo\hobi-secure-backups\20261104T222229Z_6bdb389b\hobi_chat_app_20261104T222229Z.dump` | 789,275 bytes | `4C3194588BF463B3748C5B9B335B7E092AE39DD54E0D82011E6602FD324F4455` | `pg_restore --list` exited successfully; PostgreSQL 18.4 archive; 532 TOC entries; nonzero size |
| `D:\medo\hobi-secure-backups\20261104T222229Z_6bdb389b\postgres_globals_20261104T222229Z.sql` | 1,059 bytes | `C7C3BD933E156ABD6727F130FDD3F2ED701E9D79E977E40AEA0535C1441680A7` | `pg_dumpall --globals-only` exited successfully; nonzero size |

Both data files had the Windows `Encrypted` attribute; EFS reported AES-256. The backup directory ACL was checked after creation. EFS reported **no recovery certificate**; decryptability therefore depends on the current Windows user's EFS certificate. Keep that key safe; it is not included beside the backup.

**Restore test:** not run. Archive-list validation proves the custom archive is readable, not that a complete restore will succeed.

## 5. Backup Manifest Location

Manifest: [`backup-manifest.md`](../hobi-secure-backups/20261104T222229Z_6bdb389b/backup-manifest.md)

The manifest records database identity, time, paths, sizes, hashes, tools, global-object status, verification, encryption, ACL notes, and restore-test status. It contains no credentials.

## 6. Backup Coverage and Limitations

- The database archive contains the full `chat_app` database dump, including schemas and objects selected by default by `pg_dump`, data, large objects (`--blobs`), and the associated schema definitions/ACL statements.
- The globals dump succeeded and was created with `pg_dumpall --globals-only`, covering cluster roles and tablespaces available to that command.
- PostgreSQL server configuration files, external extension binaries, and the PostgreSQL installation itself are not included.
- No restore rehearsal was performed.
- The EFS recovery certificate was absent. The encrypted files should not be moved to another account or machine without securing the corresponding EFS key.
- This backup represents the database after the earlier test attempt. It is not a pre-incident baseline and cannot by itself prove whether earlier data changed.

## 7. Previous Test Execution Reconstruction

### Source path

The test calls `getMessages` with a fifth argument intended as the fake database in [tests/privateMessageSecurity.test.ts](./tests/privateMessageSecurity.test.ts#L139). It then asserts that no `UPDATE` was issued to the fake query recorder at line 148.

The service implementation directly imports `dbPool` in [server/services/privateMessageService.ts](./server/services/privateMessageService.ts#L1), declares `getMessages(conversationId, userId, limit, beforeId)` at line 129, and has no database dependency parameter. The extra fifth argument therefore does not replace the real pool.

### SQL path and parameters

First, `resolveUserKey` looks up the user key with `LIMIT 1` ([privateMessageService.ts](./server/services/privateMessageService.ts#L14)):

```sql
SELECT uid, id::text AS id
FROM users
WHERE uid = $1
   OR id::text = $1
   OR idreg::text = $1
   OR lower(username) = lower($1)
LIMIT 1
```

For the test's `userId = "observer-id"`, it then selects messages for `conversation_id = "member-a:member-b"`; `beforeId` is omitted, so no cursor subquery applies. The service subsequently calls the following update ([privateMessageService.ts](./server/services/privateMessageService.ts#L151)):

```sql
UPDATE private_messages
SET read_at = now()
WHERE conversation_id = $1
  AND receiver_id = $2
  AND read_at IS NULL
```

Parameters for the update are:

```text
$1 = "member-a:member-b"
$2 = normalized "observer-id"
```

If `resolveUserKey` found no row, `$2` remains `"observer-id"`. If it found a row, `$2` becomes that row's `uid`, or its `id` if `uid` is empty/null. The query's `LIMIT 1` makes duplicate legacy matches ambiguous.

The previous run summary records that execution reached the database `SELECT` and attempted the update path, but the result/command tag and affected-row count were not retained. This task did not replay the operation.

## 8. Current Matching Records — Read Only

For each forensic query, the client executed `BEGIN READ ONLY`, checked `SHOW transaction_read_only`, and continued only when the value was `on`. The queries inspected identifiers, timestamps, and read-state metadata only; no message body or user profile was selected.

| Check | Current result |
|---|---:|
| User rows matching the resolver key `observer-id` | 0 |
| Possible normalized receiver keys under current data | 1 (the raw fallback key) |
| Rows in `private_messages` with conversation `member-a:member-b` | 0 |
| Rows matching that conversation and the resolver-adjusted receiver key | 0 |
| Currently unread matching rows | 0 |
| Currently read matching rows | 0 |
| Matching row dates / internal message IDs | None; no matching rows to list |

These are facts about the database **at the time of this investigation**. They do not prove that the rows were absent at the earlier test time. The current snapshot is not a pre-incident baseline.

## 9. Database Audit and Transaction Evidence

Read-only inspection of current PostgreSQL settings returned:

- `log_statement = none`
- `log_min_duration_statement = -1`
- `log_min_error_statement = error`
- `logging_collector = on`
- `log_directory = log`
- `log_filename = postgresql-%Y-%m-%d_%H%M%S.log`
- `log_timezone = Asia/Riyadh`
- `pgaudit` setting unavailable; no audit/statistics extensions were installed in `pg_extension`
- `shared_preload_libraries` was empty; `pg_stat_statements` was not installed

The available PostgreSQL logs were scanned without printing raw lines. No `UPDATE ... private_messages` statement, either synthetic parameter string, or `COMMIT`/`ROLLBACK` statement was found. The latest available log file was `postgresql-2026-10-31_000000.log`, last modified `2026-11-04T22:26:28Z`.

**Interpretation limit:** PostgreSQL was configured not to log successful SQL statements or statement durations. `log_min_error_statement=error` can record failed statements, but a successful update would not be recorded under these settings. The absence of matching log text and transaction lines therefore does **not** prove that no update or commit occurred. No provider audit log exists in the evidence inspected; this is a local PostgreSQL service, not an identified hosted provider.

## 10. Potential Data Impact

- **Current snapshot:** no message row remains with the synthetic conversation ID, and no row matches the update's current receiver-key condition.
- **At the time of the attempt:** unknown. A successful `UPDATE` could affect only rows that existed then with the exact conversation and normalized receiver key and had `read_at IS NULL`.
- The update changes only `read_at`; it does not change message bodies or balances. Nevertheless, changing read state is a persistent data change and may affect unread indicators.
- Because the test did not retain the update result and the database has no historical query/audit evidence for successful statements, the number of rows affected cannot be established.
- No message text or other private content was exposed in this report.

## 11. What Is Proven and What Remains Unknown

### Proven by current evidence

- The test source passes a fake DB argument that the service does not accept.
- The service uses the imported `dbPool` for key resolution, message reads, and the update.
- A secure local backup of the current database and a globals dump were created and validated before the forensic queries.
- Every diagnostic database query in this task ran in a transaction verified read-only.
- The current snapshot has zero rows matching the synthetic conversation/update criteria.
- Current PostgreSQL logging does not retain successful UPDATE statements or transaction outcomes.

### Unknown

- Whether the prior `UPDATE` completed successfully.
- Whether it affected zero, one, or multiple rows at the time.
- Whether any matching rows existed before the current snapshot.
- Whether any matching `read_at` value was changed by the test or by another request.
- Whether the prior operation committed or rolled back; the test's exact connection/transaction outcome was not retained.
- Whether data changed after the attempt or whether any earlier rows were deleted/altered by other operations.
- Whether the data in this local database represents production data. Production status remains unverified.

Therefore:

```text
PREVIOUS_UPDATE_OUTCOME: UNKNOWN
```

## 12. Recommendations for Independent Verification

1. Preserve this post-attempt backup and the existing PostgreSQL logs; do not restore the backup over the current database.
2. Locate the exact timestamp and process output for the earlier test from the test runner/session logs. Do not rerun the test.
3. Have the database owner independently inspect any external audit, host, or backup/PITR records that predate the attempt.
4. If a pre-attempt snapshot/WAL archive exists, restore it to a disposable isolated PostgreSQL instance and compare only the affected conversation/receiver/read-state metadata. Do not connect that instance to application services.
5. Do not claim “no data changed” unless direct pre/post evidence establishes the relevant rows and their `read_at` values.
6. Correct test dependency injection and authorization defects only under a separate implementation authorization; no such changes were made here.

## 13. Final Incident Status

```text
CURRENT_PROJECT_DATABASE_USED: YES
FULL_BACKUP_CREATED: YES
BACKUP_VERIFIED: YES
BACKUP_SHA256: 4C3194588BF463B3748C5B9B335B7E092AE39DD54E0D82011E6602FD324F4455
BACKUP_RESTORE_TEST: NOT_RUN
DATABASE_INVESTIGATION: YES
INVESTIGATION_READ_ONLY: YES
DATABASE_WRITES_DURING_THIS_TASK: NONE
CODE_CHANGES: NONE (this requested report is the only project file created)
TEST_EXECUTION: NONE
MIGRATIONS: NONE
DEPLOYMENTS: NONE
PREVIOUS_UPDATE_OUTCOME: UNKNOWN
PRODUCTION_STATUS: UNVERIFIED
FINAL_STATUS: PARTIAL
```

`PARTIAL` is required because the backup and read-only investigation completed, but available evidence cannot establish whether the earlier attempted update committed or changed data.
