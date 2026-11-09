# PERFORMANCE PHASE 3 DEFERRED ITEMS REPORT
## Controlled Deferral Catalog & Pre-Requisite Requirements
**Project:** Hobi (Serene Panda)  
**Root Path:** `D:\medo\hobi`  
**Execution Phase:** `PHASE_3_TARGETED_REMEDIATION`  
**Execution Timestamp:** 2026-11-06T02:10:00+03:00  

---

## 1. Deferral Policy & Objective

In accordance with strict pair-programming and evidence-first standards, code changes were **intentionally deferred** for items that:
1. Cannot be proven safe without database migrations or schema alterations.
2. Require live browser runtime tracing (DevTools Performance Profiling) that cannot be safely captured while the application server is blocked by the Startup Safety Gate.
3. Risk altering business logic, edge-case lookups, or user-facing UI behavior without deterministic verification data.

This report catalogs all deferred items, documents the exact rationale for deferral, and specifies the prerequisite requirements for each.

---

## 2. Comprehensive Catalog of Deferred Items

### Item 1: Profile Query Optimization (`findLegacyUserProfile`)

| Attribute | Details |
| :--- | :--- |
| **Finding ID / Root Cause ID** | `F-01` / `RC-01` |
| **Component** | `server/services/profileService.ts:113–133` |
| **Deferred Problem** | Inability to use B-tree index on `idreg` (due to `CAST(idreg AS varchar)`) and lack of index for `CONCAT('#', ...)`. |
| **Exact Reason for Deferral** | The query supports 5 distinct identifier formats (`uid`, `id`, `idreg`, `#idreg`, `username`). Rewriting or splitting the query into conditional branches risks returning different rows when multiple columns match a generic input (e.g. numeric username vs idreg), because the current query has no deterministic `ORDER BY`. Furthermore, fixing this properly requires creating an expression index or altering `idreg` comparisons in the database, which violates `DATABASE_DDL: FORBIDDEN`. |
| **Prerequisites for Future Action** | 1. Independent authorization to create database indexes (`CREATE INDEX users_idreg_varchar_idx...`).<br/>2. A comprehensive regression test suite verifying lookup equivalence across all 5 formats with colliding values. |

---

### Item 2: Application Startup Auto-Migrations Refactoring

| Attribute | Details |
| :--- | :--- |
| **Finding ID / Root Cause ID** | `F-03` / `RC-08` |
| **Component** | `server/plugins/database.ts:45–124` |
| **Deferred Problem** | Nitro plugin automatically executes non-idempotent DDL statements (`ALTER TABLE`), seeds accounts, and purges Redis keys on every server boot. |
| **Exact Reason for Deferral** | Modifying bootstrap scripts to decouple migrations into an independent CLI script (`npm run db:migrate`) requires an independent deployment architecture review. The user's explicit instructions prohibited modifying startup scripts or adding bypass flags (`AUTO_MIGRATE=false`) in Phase 3. |
| **Prerequisites for Future Action** | Authorization to decouple migration execution from Nitro application bootstrap, enabling safe local development and test runs without unintended DDL/DML. |

---

### Item 3: Wall Feed 4-Way OR Join & Correlated Subquery Optimization

| Attribute | Details |
| :--- | :--- |
| **Finding ID / Root Cause ID** | `F-04` / `RC-04` & `F-11` / `RC-11` |
| **Component** | `server/services/wallService.ts:86–101` & `wallService.ts:264` |
| **Deferred Problem** | Joining `bars` to `users` with a 4-way OR condition forces a Nested Loop join; correlated subquery for author role icons. |
| **Exact Reason for Deferral** | Current query execution takes `<2ms` on local datasets. Refactoring the join to rely strictly on an authoritative foreign key (`b.author_id = u.id`) risks breaking display names and avatars for legacy posts that rely on fallback matching (`b.topic = u.username`). Schema backfill and foreign key constraints are required first. |
| **Prerequisites for Future Action** | Data audit verifying that 100% of rows in `bars` have a valid `author_id` referencing `users.id`, followed by safe query refactoring. |

---

### Item 4: Profile Modal GPU Compositing & Dialog Scroll-Lock

| Attribute | Details |
| :--- | :--- |
| **Finding ID / Root Cause ID** | `F-07` / `RC-03` & `RC-10` |
| **Component** | `src/components/profile/ProfileModal.tsx:249` & `src/components/ui/dialog.tsx:39` |
| **Deferred Problem** | `backdrop-blur-2xl` fragment shader cost; Radix Dialog body scroll-lock reflow. |
| **Exact Reason for Deferral** | Removing `backdrop-blur-2xl` based on unmeasured GPU hypotheses was explicitly prohibited by user guidelines. Disabling body scroll lock in `@radix-ui/react-dialog` could allow background page scrolling while the modal is open, degrading UX on mobile devices. |
| **Prerequisites for Future Action** | Capturing a live Chrome DevTools Performance profile trace on real target devices (e.g. mobile Safari / low-end Android / Intel UHD graphics) to measure real framerate and layout durations. |

---

### Item 5: Eager Bundling of 25 Admin Dashboard Sections

| Attribute | Details |
| :--- | :--- |
| **Finding ID / Root Cause ID** | `F-05` / `RC-09` |
| **Component** | `src/components/admin/AdminDashboard.tsx:9–36` |
| **Deferred Problem** | 25 distinct admin section components are imported statically rather than lazily. |
| **Exact Reason for Deferral** | Splitting 25 sections into dynamic `React.lazy()` imports requires establishing Suspense boundaries and fallback skeleton UIs for each section. The real-world bundle transfer impact could not be measured because the web server was inactive. |
| **Prerequisites for Future Action** | Production bundle analysis (`vite build --analyze`) measuring initial JS payload weight, followed by atomic Suspense implementation. |

---

### Item 6: In-Memory Profile Visitors Map Eviction

| Attribute | Details |
| :--- | :--- |
| **Finding ID / Root Cause ID** | `F-09` / `RC-12` |
| **Component** | `server/services/profileService.ts:180–182` |
| **Deferred Problem** | `localProfileVisits` stores visitor lists in an in-memory Node process `Map`. |
| **Exact Reason for Deferral** | The list is already sliced to a maximum of 30 items per profile. Replacing the in-memory map with an external Redis Sorted Set requires Redis writes and cache modeling, which is out of scope for local read-only code changes. |
| **Prerequisites for Future Action** | Implementing an asynchronous Redis-backed visitor history queue with TTL eviction. |
