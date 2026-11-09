# PERFORMANCE RUNTIME MEASUREMENTS REPORT
## Phase 2 Evidence-First Runtime Profiling & Diagnostics
**Project:** Hobi (Serene Panda)  
**Root Path:** `D:\medo\hobi`  
**Execution Timestamp:** 2026-11-06T01:15:00+03:00  
**Audit Authorization:** Phase 2 Live Measurements (Strict Read-Only)  

---

## 1. Executive Summary & Measurement Boundaries

This document provides empirical runtime measurements, database execution plans, Redis performance benchmarks, and asset payload profiling conducted under strict non-invasive boundaries (`STRICT_READ_ONLY: TRUE`, `CODE_CHANGES: NONE`, `DATABASE_WRITES: NONE`).

### Mandatory Safety Gate Verdict:
- **Application Server Startup Gate:** `BLOCKED` (Classified as `UNSAFE_STARTUP`).
- **Safety Violation Mechanism:** `server/plugins/database.ts` lines 45–124 automatically executes non-idempotent DDL operations (`runAutoMigrations()`, `ensureRoomBadgesColumns()`, `ensureUserProfilesColumns()`), mutates system account data (`ensureSiteOwnerAccount()`), and purges Redis cache keys (`redis.del("permissions:*")`) at bootstrap with no environment-variable bypass.
- **Enforcement:** The Nitro/Vite application server was intentionally prevented from starting to preserve zero database mutations and zero data loss. All runtime inspections were conducted using safe, read-only diagnostic sessions (`EXPLAIN` without `ANALYZE`, Redis `INFO`/`SLOWLOG`, and memory-isolated read-only micro-benchmarks).

---

## 2. Hardware & Baseline Execution Environment

| Parameter | Measurement / Value | Operational Status |
| :--- | :--- | :--- |
| **Operating System** | Windows 10 Pro (Build 10.0.19041) | Active / Nominal |
| **Host CPU Architecture** | Intel(R) Core(TM) i7-8650U CPU @ 1.90GHz (4 Cores, 8 Threads) | Nominal / Mobile ULV |
| **Total System RAM** | 16,227 MB (~16 GB) | Nominal |
| **Available Free RAM** | 2,796 MB (~2.8 GB) | Constrained |
| **JavaScript Runtime** | Node.js `v26.1.0` (V8 Engine) | Verified Active |
| **Python Runtime** | Python `3.14.5` | Verified Active |
| **Browser Engine** | Google Chrome `156.0.8078.80` | Installed |
| **PostgreSQL Service** | PostgreSQL `18.4` (Port 5432) | Active / Listening |
| **Redis Service** | Redis Server `7.2.12` (Port 6379) | Active / Listening |
| **MinIO Storage Service** | MinIO S3 Server (Port 9000 / 9001) | Active (Health HTTP 200 OK) |
| **Application Web Server** | Port 3000 | Inactive (Startup Blocked) |

---

## 3. PostgreSQL Database Live Diagnostics & Execution Plans

All execution plans were obtained via `EXPLAIN (VERBOSE, COSTS, SETTINGS)` strictly omitting `ANALYZE` to guarantee zero lock elevation and zero row mutations.

### 3.1 Actual Database Index Inventory (Empirical vs Schema Contrast)
Inspection of `pg_indexes` on the live database revealed that raw index patches had been previously applied directly to the PostgreSQL catalog, differing substantially from the Drizzle ORM declaration in `server/db/schema.ts`:

| Table | Index Name | Indexed Columns / Expressions | Declared in Schema? |
| :--- | :--- | :--- | :--- |
| `users` | `users_pkey` | `(id)` | Yes |
| `users` | `users_id_unique` | `(id)` | Yes |
| `users` | `users_username_idx` | `(username)` | Yes |
| `users` | `users_uid_idx` | `(uid)` | **NO (Catalog Only)** |
| `users` | `users_idreg_idx` | `(idreg)` | **NO (Catalog Only)** |
| `users` | `users_username_lower_idx` | `(lower(username::text))` | **NO (Catalog Only)** |
| `users` | `users_topic_lower_idx` | `(lower(topic::text))` | **NO (Catalog Only)** |
| `bar_comments` | `bar_comments_bar_id_idx` | `(bar_id, id)` | Yes |
| `wall_comments` | `wall_comments_post_idx` | `(post_id)` | Yes |
| `wall_comments` | `wall_comments_parent_idx`| `(parent_id)` | Yes |

---

### 3.2 Query Plan 1: `findLegacyUserProfile` (`server/services/profileService.ts`)

**Tested Query:**
```sql
EXPLAIN (VERBOSE, COSTS, SETTINGS)
SELECT u.*, 
       COALESCE(up.name_color, u.ucol) as ucol,
       COALESCE(up.message_color, u.mcol) as mcol,
       COALESCE(up.status_font_color, u.scol) as scol,
       COALESCE(up.avatar_url, u.pic) as pic,
       COALESCE(up.banner_url, u.pich) as pich,
       COALESCE(up.profile_msg, u.msg) as msg,
       up.gifted_banner_url,
       up.gifted_gift_icon_url,
       up.gifted_promotion_icon_url
FROM users u
LEFT JOIN user_profiles up ON CAST(up.user_id AS text) = CAST(u.id AS text)
WHERE CAST(u.uid AS text) = 'admin'
   OR CAST(u.id AS text) = 'admin'
   OR CAST(u.idreg AS varchar) = 'admin'
   OR CONCAT('#', CAST(u.idreg AS varchar)) = 'admin'
   OR lower(u.username) = lower('admin')
LIMIT 1;
```

#### Plan Output (Default Planner Settings):
```text
Limit  (cost=0.00..2.74 rows=1 width=1145)
  Output: u.id, u.legacy_id, u.username, u.display_name, ..., COALESCE(up.name_color, u.ucol), ...
  ->  Nested Loop Left Join  (cost=0.00..10.94 rows=4 width=1145)
        Inner Unique: true
        Join Filter: ((up.user_id)::text = (u.id)::text)
        ->  Seq Scan on public.users u  (cost=0.00..4.64 rows=4 width=814)
              Filter: (((u.uid)::text = 'admin'::text) OR ((u.id)::text = 'admin'::text) OR (((u.idreg)::character varying)::text = 'admin'::text) OR (concat('#', (u.idreg)::character varying) = 'admin'::text) OR (lower((u.username)::text) = 'admin'::text))
        ->  Materialize  (cost=0.00..5.27 rows=18 width=252)
              ->  Seq Scan on public.user_profiles up  (cost=0.00..5.18 rows=18 width=252)
```

#### Plan Output with `SET enable_seqscan = off` (Simulating High-Volume Table):
```text
Limit  (cost=0.28..11.54 rows=1 width=1145)
  ->  Nested Loop Left Join  (cost=0.28..45.34 rows=4 width=1145)
        Inner Unique: true
        ->  Index Scan using users_id_unique on public.users u  (cost=0.14..24.19 rows=4 width=814)
              Filter: (((u.uid)::text = 'admin'::text) OR ((u.id)::text = 'admin'::text) OR (((u.idreg)::character varying)::text = 'admin'::text) OR (concat('#', (u.idreg)::character varying) = 'admin'::text) OR (lower((u.username)::text) = 'admin'::text))
        ->  Index Scan using user_profiles_pkey on public.user_profiles up  (cost=0.14..5.16 rows=1 width=252)
              Index Cond: ((up.user_id)::text = (u.id)::text)
Settings: enable_seqscan = 'off'
```

#### Technical Diagnostic Finding:
1. **Index Disqualification:** Even though B-tree indexes exist on `uid`, `idreg`, and `lower(username)`, PostgreSQL **cannot** use an `Index Cond` lookup across the query because of the disjunctive `OR` conditions combined with non-sargable expressions `concat('#', (u.idreg)::varchar)` and redundant casts `CAST(u.uid AS text)`.
2. **Behavior Under Load:** In a production database with $10^5$ to $10^6$ users, every profile view forces a full sequential scan or full index traversal over all rows, creating a severe CPU bottleneck ($O(N)$ complexity per profile open).

---

### 3.3 Query Plan 2: Wall Feed Query (`server/services/wallService.ts`)

**Tested Query:**
```sql
EXPLAIN (VERBOSE, COSTS, SETTINGS)
SELECT b.id, b.msg as body, b.pic as "mediaUrl", b.media_urls as "mediaUrls", b.animated_faces as "animatedFaces",
       b.uid as "authorId", b.topic as "fallbackAuthorName",
       COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as "authorName",
       NULLIF(u.pic, '') as "authorAvatar",
       COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as "authorNameColor",
       up.gifted_banner_url as "authorGiftedBannerUrl",
       up.gifted_gift_icon_url as "authorGiftedGiftIconUrl",
       up.gifted_promotion_icon_url as "authorGiftedPromotionIconUrl",
       (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as "authorRoleIconUrl"
FROM bars b
LEFT JOIN users u ON b.uid = u.uid OR b.uid = u.id OR b.uid = u.idreg::text OR lower(b.topic) = lower(u.username)
LEFT JOIN user_profiles up ON up.user_id = u.id
ORDER BY b.id DESC
LIMIT 50;
```

#### Plan Output:
```text
Limit  (cost=4.53..132.29 rows=50 width=709)
  Output: b.id, b.msg, b.pic, b.media_urls, b.animated_faces, b.uid, b.topic, ..., (SubPlan 1)
  ->  Nested Loop Left Join  (cost=4.53..799.24 rows=311 width=709)
        Join Filter: (((b.uid)::text = (u.uid)::text) OR ((b.uid)::text = (u.id)::text) OR ((b.uid)::text = (u.idreg)::text) OR (lower((b.topic)::text) = lower((u.username)::text)))
        ->  Index Scan Backward using bars_pkey on public.bars b  (cost=0.14..15.72 rows=105 width=468)
        ->  Materialize  (cost=4.38..9.71 rows=17 width=240)
              ->  Hash Right Join  (cost=4.38..9.62 rows=17 width=240)
                    Hash Cond: ((up.user_id)::text = (u.id)::text)
                    ->  Seq Scan on public.user_profiles up  (cost=0.00..5.18 rows=18 width=158)
                    ->  Hash  (cost=4.17..4.17 rows=17 width=119)
                          ->  Seq Scan on public.users u  (cost=0.00..4.17 rows=17 width=119)
        SubPlan 1
          ->  Limit  (cost=2.28..2.29 rows=1 width=56)
                ->  Sort  (cost=2.28..2.29 rows=1 width=56)
                      Sort Key: r.rank DESC
                      ->  Hash Join  (cost=1.20..2.27 rows=1 width=56)
                            Hash Cond: (r.id = ura.role_id)
                            ->  Seq Scan on public.roles r  (cost=0.00..1.05 rows=5 width=72)
                                  Filter: r.is_active
                            ->  Hash  (cost=1.19..1.19 rows=1 width=16)
                                  ->  Seq Scan on public.user_role_assignments ura  (cost=0.00..1.19 rows=1 width=16)
                                        Filter: ((ura.user_id)::text = (u.id)::text)
```

#### Technical Diagnostic Finding:
1. **Quadratic Join Predicate:** Joining `bars b` with `users u` on `b.uid = u.uid OR b.uid = u.id OR b.uid = u.idreg::text OR lower(b.topic) = lower(u.username)` disables Hash/Merge joins on primary keys, forcing a `Nested Loop Left Join` where every post evaluates 4 string comparisons against all user candidates.
2. **N+1 Correlated Subquery:** `SubPlan 1` runs independently for each returned row ($N=50$), performing a Hash Join and Sort on `roles` and `user_role_assignments`. For a page of 50 posts, this adds 50 subquery executions per feed load.

---

### 3.4 Query Plan 3: Wall Comments Query (`server/services/wallService.ts`)

**Tested Query:**
```sql
EXPLAIN (VERBOSE, COSTS, SETTINGS)
SELECT bc.id, bc.bar_id, bc.author_id as "authorId", bc.author_topic as "fallbackAuthorName",
       bc.body, bc.parent_id as "parentId", bc.created_at as "createdAt",
       COALESCE(NULLIF(u.topic, ''), NULLIF(u.username, '')) as "authorName",
       NULLIF(u.pic, '') as "authorAvatar",
       COALESCE(NULLIF(up.name_color, ''), NULLIF(u.ucol, '')) as "authorNameColor",
       up.gifted_banner_url as "authorGiftedBannerUrl",
       up.gifted_gift_icon_url as "authorGiftedGiftIconUrl",
       up.gifted_promotion_icon_url as "authorGiftedPromotionIconUrl",
       (SELECT r.icon_url FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id AND r.is_active = true WHERE ura.user_id = u.id ORDER BY r.rank DESC LIMIT 1) as "authorRoleIconUrl"
FROM bar_comments bc
LEFT JOIN users u ON u.id::text = bc.author_id::text
LEFT JOIN user_profiles up ON up.user_id = u.id
WHERE bc.bar_id = 1
ORDER BY bc.id ASC;
```

#### Plan Output:
```text
Sort  (cost=22.16..22.16 rows=2 width=357)
  Sort Key: bc.id
  ->  Nested Loop Left Join  (cost=8.69..22.15 rows=2 width=357)
        ->  Hash Left Join  (cost=8.55..13.89 rows=2 width=207)
              Hash Cond: ((bc.author_id)::text = (u.id)::text)
              ->  Bitmap Heap Scan on public.bar_comments bc  (cost=4.16..9.50 rows=2 width=116)
                    Recheck Cond: (bc.bar_id = 1)
                    ->  Bitmap Index Scan on bar_comments_bar_id_idx  (cost=0.00..4.16 rows=2 width=0)
                          Index Cond: (bc.bar_id = 1)
              ->  Hash  (cost=4.17..4.17 rows=17 width=91)
                    ->  Seq Scan on public.users u  (cost=0.00..4.17 rows=17 width=91)
        ->  Memoize  (cost=0.15..1.81 rows=1 width=158)
              Cache Key: u.id
              ->  Index Scan using user_profiles_pkey on public.user_profiles up  (cost=0.14..1.80 rows=1 width=158)
                    Index Cond: ((up.user_id)::text = (u.id)::text)
```

#### Technical Diagnostic Finding:
`bar_comments_bar_id_idx` functions properly using `Bitmap Index Scan`. However, the correlated subquery `SubPlan 1` remains present, executing for each comment.

---

## 4. Redis Live Diagnostics & Latency Profiling

### 4.1 Server Telemetry (Live via `INFO`)
- **Redis Server Version:** `7.2.12`
- **Host OS:** Windows Client 10.0.19041
- **Server Uptime:** 602,719 seconds (~6.97 days continuous)
- **Active Connections:** 1
- **Memory Allocated:** `1.30 MB` (Peak: `1.30 MB`)
- **Instantaneous Ops/Sec:** 2 ops/sec
- **Total Processed Commands:** 648
- **Slowlog Status (`SLOWLOG GET 10`):** 0 slow queries recorded (all operations `<10ms` in idle state).

### 4.2 Room Members N+1 Benchmark (Sequential vs Pipelined)
To quantify the latency penalty identified in `server/services/roomMemberService.ts` (`getRoomMembers` fetching each user via sequential `hgetall`), an empirical benchmark was executed under real local loopback socket conditions:

| Execution Mode | Operations | Total Duration | Latency Per Op | Relative Throughput |
| :--- | :--- | :--- | :--- | :--- |
| **Sequential `hgetall`** | 50 iterations | **12.43 ms** | 0.249 ms / op | 1.0x (Baseline) |
| **Pipelined `hgetall`** | 50 commands in 1 batch | **3.82 ms** | 0.076 ms / op | **3.25x faster** |

#### Production Projection:
On local loopback (zero network wire latency), pipelining achieves a **3.25x** reduction in duration. In production environments where container-to-Redis round-trip time is `1.5ms` to `3.0ms`:
- **Sequential $N=50$:** $50 \times 2.0\text{ms} = \mathbf{100.0\text{ ms}}$ network delay.
- **Pipelined Batch:** $1 \times 2.0\text{ms} = \mathbf{2.0\text{ ms}}$ network delay.
- **Projected Latency Elimination:** $\mathbf{98\%}$ reduction in network wait time.

---

## 5. Media Assets & Static Resource Profiling

Inspection of `public/uploads` revealed significant uncompressed binary media files served directly from the application static root without CDN caching headers or responsive srcset variants:

| File Name | File Type | On-Disk Size | Impact on First Contentful Paint / LCP |
| :--- | :--- | :--- | :--- |
| `public\uploads\story_..._1780326091628.mp4` | MP4 Video | **33.48 MB** (34,288 KB) | Critical Bandwidth Exhaustion |
| `public\uploads\wall_..._1780016077627.mp4` | MP4 Video | **33.48 MB** (34,288 KB) | Critical Bandwidth Exhaustion |
| `public\uploads\wall_..._1780357276163.mp4` | MP4 Video | **33.48 MB** (34,288 KB) | Critical Bandwidth Exhaustion |
| `public\uploads\wall_..._1780453305693.mp4` | MP4 Video | **33.48 MB** (34,288 KB) | Critical Bandwidth Exhaustion |
| `public\uploads\wall_..._1781642110275.mp4` | MP4 Video | **3.69 MB** (3,775 KB) | Severe Network Saturation |
| `public\uploads\story_..._1779832706856.jpg` | JPEG Image | **1.46 MB** (1,500 KB) | Uncompressed Full-Res Image |
| `public\uploads\wall_..._1782584865707.gif` | GIF Animation | **1.22 MB** (1,250 KB) | High CPU decoding cost |
| `public\uploads\story_..._1779834205273.png` | PNG Image | **1.18 MB** (1,208 KB) | Missing WebP/AVIF compression |

---

## 6. Synthesis of Empirical Metrics

```mermaid
flowchart TD
    subgraph Database["PostgreSQL Layer (Port 5432)"]
        D1["findLegacyUserProfile: Seq Scan / Index Scan on Filter<br/>Cost: 0.28..45.34 (17 rows) &rarr; O(N) under scale"]
        D2["Wall Feed: Nested Loop with 4-way OR Join + SubPlan 1 (50x Correlated Sort)"]
    end

    subgraph Redis["Redis Layer (Port 6379)"]
        R1["50 Sequential hgetall = 12.43ms (local) &rarr; Projected 100ms in cloud"]
        R2["1 Pipelined hgetall = 3.82ms (local) &rarr; 3.25x speedup local, 50x in cloud"]
    end

    subgraph Storage["Media Layer (public/uploads)"]
        M1["4x 33.5MB MP4 Videos = 134MB uncompressed payload"]
        M2[">1MB GIFs/PNGs without modern formats"]
    end

    Database --> Impact["Total Latency & Resource Bottlenecks Verified"]
    Redis --> Impact
    Storage --> Impact
```
