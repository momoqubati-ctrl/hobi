# PERFORMANCE PHASE 2.1 EVIDENCE REVIEW REPORT
## Critical Evidence Reconciliation, Fact-Checking & Assumption Elimination
**Project:** Hobi (Serene Panda)  
**Root Path:** `D:\medo\hobi`  
**Phase:** Phase 2.1 Evidence Review (Strict Read-Only)  
**Execution Timestamp:** 2026-11-06T01:45:00+03:00  

---

## 1. Objectives & Guiding Principles

This report performs a rigorous, evidence-first review of all claims, metrics, and findings produced during Phase 2. 

The primary objective is to separate:
1. **Static Code Patterns:** Patterns in code that theoretically could cause a bottleneck under specific conditions.
2. **PostgreSQL Query Plan Evidence:** What `EXPLAIN (VERBOSE, COSTS, SETTINGS)` mathematically proves regarding planner strategy, cost models, and index selection.
3. **Actual Runtime Measurements:** Real latency, CPU, and memory numbers captured empirically on the host machine.
4. **Theoretical Projections:** Extrapolations to multi-user or cloud environments, which must be clearly labeled and bounded by explicit assumptions.
5. **Unverified Claims / Blocked Telemetry:** Claims that could not be measured directly due to the Startup Safety Gate or lack of browser performance traces.

---

## 2. Profile Query (`findLegacyUserProfile`) — F-01 / RC-01

### 2.1 Re-examination of the Evidence
In Phase 2, the report claimed: *"PostgreSQL failed completely to use indexes, forcing a full sequential scan of $O(N)$ with an estimated latency of 300ms–1800ms."*

A deeper, isolated verification of `users` table schema, column types, and planner behavior reveals a more nuanced, precise reality:

#### A. Column Types vs Query Types
From `information_schema.columns`:
- `id`: `character varying` (`varchar`)
- `uid`: `character varying` (`varchar`)
- `username`: `character varying` (`varchar`)
- `idreg`: `integer` (`int4`) — **CRITICAL FACTOR**

#### B. Index Availability
From `pg_indexes`:
- `users_pkey` on `(id)` — B-tree
- `users_id_unique` on `(id)` — B-tree
- `users_uid_idx` on `(uid)` — B-tree
- `users_username_lower_idx` on `(lower(username::text))` — B-tree Expression Index
- `users_idreg_idx` on `(idreg)` — B-tree Integer Index

#### C. Isolated Usability Tests (via Safe `EXPLAIN` with `enable_seqscan = off`):
1. `lower(username) = lower('admin')`:
   - Uses `Index Scan using users_username_lower_idx` with direct `Index Cond`. **INDEX FULLY USABLE.**
2. `uid = 'admin'` and `CAST(uid AS text) = 'admin'`:
   - Both use `Index Scan using users_uid_idx` with direct `Index Cond`. **INDEX FULLY USABLE.**
3. `uid = $1 OR lower(username) = lower($1)`:
   - Uses `Bitmap Heap Scan` with `BitmapOr` combining `users_uid_idx` and `users_username_lower_idx`. **BITMAP OR FULLY USABLE.**
4. `idreg = 123` (integer parameter):
   - Uses `Index Scan using users_idreg_idx`. **INDEX FULLY USABLE.**
5. `CAST(idreg AS varchar) = '123'`:
   - **FAILS INDEX USAGE.** Because `idreg` is an `integer` column, wrapping it in `CAST(... AS varchar)` prevents the integer B-tree index from being used, forcing a sequential filter.
6. `CONCAT('#', CAST(idreg AS varchar)) = $1`:
   - **FAILS INDEX USAGE.** No expression index exists for this concatenated string.

### 2.2 Why Did Default EXPLAIN Choose `Seq Scan`?
- In the local development database, `users` has **17 rows**.
- The planner's estimated cost for `Seq Scan` across 17 rows is **4.64**.
- The estimated cost for `BitmapOr` is **8.29**.
- PostgreSQL chose `Seq Scan` under default settings **purely because the table is tiny**, which is optimal planner behavior.
- However, when the full composite query was tested with `enable_seqscan = off`, PostgreSQL could not construct a complete `BitmapOr` because of `CAST(idreg AS varchar)` and `concat('#', ...)`. It fell back to scanning `users_id_unique` and filtering the remaining rows.

### 2.3 Reconciliation of What Is Proven vs What Is Not Proven
- **PROVEN:**
  - Column `idreg` is an `integer`, but the query queries it as `varchar` via `CAST`, which completely invalidates `users_idreg_idx`.
  - Condition `CONCAT('#', ...)` has no index.
  - The combination of these two unindexed branches inside an `OR` clause prevents PostgreSQL from resolving the full query via `BitmapOr`.
  - `ProfileService.recordVisit` executes a synchronous database write (`INSERT INTO profile_visits`) and Redis update inside a read query path.
- **NOT PROVEN (Corrected):**
  - Claim that *"PostgreSQL failed completely to use indexes"*: **FALSE.** The indexes on `uid`, `id`, and `lower(username)` are completely functional and can be combined via `BitmapOr`.
  - Claim that latency is *"300ms–1800ms"*: **UNMEASURED THEORETICAL PROJECTION.** In the local test database, execution took `<1ms`. The multi-hundred millisecond figure is an unmeasured projection for millions of rows.

---

## 3. Wall Feed & Correlated Subqueries — F-04 / F-11

### 3.1 Re-examination of the Evidence
In Phase 2, the report claimed: *"SubPlan 1 executes 50 times per feed load, adding 50 independent subquery executions."*

#### A. Query Plan vs Runtime Execution Count
- In `EXPLAIN (VERBOSE, COSTS, SETTINGS)` without `ANALYZE`, `SubPlan 1` is displayed in the plan tree attached to the projection list of `bars`.
- The planner estimates `rows=50` for the outer limit.
- **Critical Fact:** `EXPLAIN` without `ANALYZE` **does not prove actual execution count**.
- If zero rows match the filter, `SubPlan 1` executes 0 times.
- If PostgreSQL memoizes or hashes subplan results (or if the client fetches fewer rows), execution count varies.
- Therefore, stating definitively that it executed 50 times is an assumption. The factual status must be recorded as:  
  `SUBPLAN_EXECUTION_COUNT: NOT_MEASURED`.

#### B. The 4-way OR Join Predicate
- The join in `server/services/wallService.ts` is:
  `LEFT JOIN users u ON b.uid = u.uid OR b.uid = u.id OR b.uid = u.idreg::text OR lower(b.topic) = lower(u.username)`
- **PROVEN:** The `OR` predicate across 4 disparate columns prevents simple primary key equi-joins, resulting in a `Nested Loop Left Join` with a join filter.
- **NOT PROVEN:** That this causes noticeable latency on current data volumes. On the current local database, the query plan cost is low (`4.53..132.29`). The performance degradation is an architectural scalability risk, not an empirically measured bottleneck on current data.

---

## 4. Redis Benchmark Evaluation — F-02 / RC-02

### 4.1 Re-examination of Application Code vs Benchmark
In Phase 2, the report benchmarked:
- 50 Sequential `hgetall` calls: `12.43 ms`
- 1 Pipelined `hgetall` batch: `3.82 ms`
And projected: *"50 * 2.0ms = 100ms in cloud network"*.

#### A. Application Code Inspection (`server/socket/presenceManager.ts`)
Inspection of `getRoomMembers` (line 510) and `getAllOnlineUsers` (line 94) reveals:
```typescript
const usersPromises = allSocketIds.map((sid) => getConnectedUser(sid));
const users = await Promise.all(usersPromises);
```
- **Code Reality:** The application uses `Promise.all()`, dispatching calls concurrently across the Node.js event loop over the `ioredis` multiplexed connection.
- **Benchmark Discrepancy:** The Phase 2 benchmark script executed an artificial `for (let i = 0; i < 50; i++) { await redis.hgetall(...) }` sequential loop!
- A sequential `await` loop waits for each packet to return before sending the next. `Promise.all` does not wait; it writes commands to the socket buffer concurrently.
- Therefore, the Phase 2 benchmark tested a purely sequential model that does **not** accurately mirror the application's asynchronous dispatch.

#### B. Reconciliation of Redis Metrics
- **PROVEN:**
  - Pipelining commands into a single RESP batch payload is strictly more efficient than multiple distinct Redis command packets.
  - The local micro-benchmark took 12.43ms for 50 sequential calls vs 3.82ms for pipelining (single run, sample size = 1).
- **NOT PROVEN (Corrected):**
  - That the application suffers 100ms latency in production: this is a `THEORETICAL_PROJECTION` based on an assumed 2ms RTT and an assumed strictly sequential round-trip model, whereas the application uses `Promise.all()`.
  - Metrics like p50, p95, and variance were not measured (only 1 sample was taken).

---

## 5. Profile Opening Stutter & Jank — RC-03 / F-07

### 5.1 Re-examination of Browser & GPU Claims
Phase 2 attributed the profile window stutter to five factors:
1. `backdrop-blur-2xl` GPU fill-rate throttling.
2. Quadruple conflicting CSS transforms.
3. Radix Dialog body scroll lock reflow (30–80ms).
4. Synchronous `localStorage.getItem` thread-lock (20–60ms).
5. DOM tree replacement from skeleton to real components.

### 5.2 Evidence Classification Matrix

| Suspected Cause | Static Code Evidence | Browser Runtime Evidence | Corrected Status |
| :--- | :--- | :--- | :--- |
| **Backdrop Blur** | `ProfileModal.tsx:249`: Class `backdrop-blur-2xl` (`backdrop-filter: blur(40px)`) over $460\text{px} \times 92\text{dvh}$ surface. | **NOT MEASURED.** (Chrome DevTools Performance Trace was not run because app server was blocked). Numbers like "15–22 FPS" are unmeasured hypotheses. | `PARTIALLY_CONFIRMED` *(Code proven; FPS drop is a probable hypothesis)* |
| **Transform Conflicts** | `dialog.tsx:39`: `zoom-in-95`, `slide-in-from-top-[48%]`, `translate-x/y`. | **NOT CONFIRMED.** Modern Tailwind merges transform variables into a single CSS matrix (`transform: translate(...) scale(...)`). There is no evidence of compositor conflict. | `NOT_CONFIRMED` *(Hypothesis invalidated by CSS spec)* |
| **Body Scroll Lock** | Radix Dialog injects `overflow: hidden` onto `document.body`. | **NOT MEASURED.** Modifying `body.overflow` triggers a style/layout recalc, but claims of "30–80ms full page reflow" were unmeasured estimates. | `PARTIALLY_CONFIRMED` *(Trigger proven; duration unmeasured)* |
| **Main Thread Blocking (localStorage)** | `ProfileModal.tsx:52–59`: `localStorage.getItem("user")` and `JSON.parse` run in render body. | **NOT MEASURED.** `JSON.parse` of a 1KB string takes `<0.05ms` on modern V8 engines. Calling it a "20–60ms thread lock" was an unsupported exaggeration. | `CONFIRMED_BY_STATIC_CODE` *(Pattern confirmed; latency negligible/unproven)* |
| **DOM Replacement** | `ProfileModal.tsx:255`: Skeleton tree unmounts and real tree mounts upon socket response. | **CONFIRMED BY CODE.** Complete unmount and mount of DOM tree confirmed in JSX. | `CONFIRMED_BY_STATIC_CODE` |

---

## 6. React Rendering Inefficiencies — F-05 / F-06

### 6.1 AdminDashboard 1-Second Timer (`setInterval`)
- **Code:** `useEffect(() => { const i = setInterval(() => setLangKey(k => k + 1), 1000); return () => clearInterval(i); }, [])` in `AdminDashboard.tsx`.
- **PROVEN:** State updates every 1,000ms while `AdminDashboard` is mounted, triggering a re-render of `AdminDashboard`.
- **NOT PROVEN (Corrected):**
  - Claim that *"all 25 sections re-render every second"*: **FALSE.** The component uses `switch (section)` inside `renderSection()`. Only the single active section is rendered. The other 24 sections are never mounted.
  - Claim that *"Garbage collection stalls the event loop"*: **NOT MEASURED.** Memory allocation profiling was not conducted.

### 6.2 ProfileModal State Cascades & React 19 Automatic Batching
- **Code:** 5 separate `setState` calls upon open and 5 upon socket resolution.
- **PROVEN:** 5 distinct state setters are called.
- **NOT PROVEN (Corrected):**
  - Claim that *"5 setState calls cause 5 separate re-renders"*: **FALSE.** React 19 features Automatic Batching across promises, microtasks, and event callbacks. The 5 state updates inside the socket callback are batched into a single render pass.
  - Actual re-render count was **NOT MEASURED** with React Profiler.

### 6.3 Socket Listeners Scope
- Phase 2 claimed: *"Any gift or profile event on the platform causes re-renders in ProfileModal."*
- **Correction:** Inspection of lines 161–205 in `ProfileModal.tsx` shows explicit guard clauses:
  `if (data && String(data.fromUserId) !== String(profileId) && ...) return;`
- Events for other users return immediately **without calling setState**. The claim of platform-wide broadcast re-renders was inaccurate.

---

## 7. Media Assets in `public/uploads` — F-08

### 7.1 Re-examination of the Evidence
Phase 2 claimed: *"Four 33.5MB MP4 files download 134MB on page load, exhausting bandwidth and destroying LCP."*

#### A. Inspection of Media Consumption (`WallFeed.tsx`)
Inspection of `src/components/chat/WallFeed.tsx` reveals:
- Line 191 & 324: `<video ... preload="metadata" />`
- Lines 129, 950, 951, 952, 1167: `<img loading="lazy" decoding="async" ... />`

#### B. Technical Facts:
1. `preload="metadata"` instructs the browser to download **only** the video container headers (duration, resolution, audio tracks), typically `10KB–50KB`. The browser **does not** download the 33.5 MB video stream until the user presses play.
2. Feed images utilize native browser lazy-loading (`loading="lazy"`). Images below the fold do not load during initial page render.
3. Disk size $\neq$ HTTP network transfer payload on page load.
4. HTTP cache headers and range requests could not be measured because the application server was stopped (`NOT_MEASURED`).
5. **Conclusion:** Storing 33.5 MB uncompressed video files on disk is an unoptimized storage practice, but the claim that they download 134 MB on initial page load was **factually incorrect**.

---

## 8. Startup Safety Gate Dissection — F-03 / RC-08

To ensure total transparency, all bootstrap operations in `server/plugins/database.ts` are categorized:

| Operation | Category | Conditionality | Exact Safety Impact |
| :--- | :--- | :--- | :--- |
| `runAutoMigrations()` | **DDL / Table Creation** | Conditional (`missingAutoMigrationTables > 0`) | Creates tables & applies migrations. |
| `ensureWalletOperationsMetadataColumn()` | **DDL (`ALTER TABLE`)** | Conditional (`missingWalletColumns > 0`) | Modifies wallet table columns. |
| `ensureRoomBadgesColumns()` | **DDL (`ALTER TABLE`)** | **UNCONDITIONAL (Runs Every Boot)** | Executes `ALTER TABLE room_badges ADD COLUMN IF NOT EXISTS ...`. |
| `ensureUserProfilesColumns()` | **DDL (`ALTER TABLE`)** | **UNCONDITIONAL (Runs Every Boot)** | Executes `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ...`. |
| `ensureAnnouncementDeliverySchema()` | **DDL (`ALTER TABLE`)** | **UNCONDITIONAL (Runs Every Boot)** | Modifies announcement tables. |
| `ensureDefaultMemberRole()` | **DML (`INSERT`)** | **UNCONDITIONAL (Runs Every Boot)** | Inserts role record if missing. |
| `ensureSiteOwnerAccount()` | **DML (`UPSERT`)** | **UNCONDITIONAL (Runs Every Boot)** | Modifies site owner password hash and row. |
| `redis.del("permissions:*")` | **Cache Deletion** | **UNCONDITIONAL (Runs Every Boot)** | Purges Redis permissions keys on every boot. |

**Verdict:** The Startup Safety Gate was completely legitimate and necessary. Three unconditional DDL operations, three unconditional DML operations, and an unconditional Redis deletion execute automatically on every server boot. Preventing startup was required to uphold `STRICT_READ_ONLY: TRUE`.
