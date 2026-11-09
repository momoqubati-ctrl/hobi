# PERFORMANCE TOOLING READINESS

**Project Target:** HOBI / Serene Panda Full-Stack Web Application  
**Runtime Environment:** Windows x64 | Node.js v26.1.0 | Python 3.14.5 | Google Chrome 144+ | PostgreSQL 16+ | Redis 7+  
**Architecture Standard:** Zero-Mutation Pre-Audit Assessment  
**Evaluation Date:** 2026-11-06  

---

## 1. System Runtime & Toolchain Status

| Component | Target Requirement | Detected Local State | Status | Verification Evidence |
|-----------|--------------------|----------------------|:------:|-----------------------|
| **Node.js** | Node 18+ (ESM Native) | `v26.1.0` | **READY** | `node -v` confirmed |
| **Python** | Python 3.8+ | `3.14.5` | **READY** | `python --version` confirmed |
| **Shell / Bash** | Git Bash / MSYS2 | GNU Bash 5.2.37 | **READY** | `bash --version` confirmed |
| **Google Chrome** | Chrome 120+ | `C:\Program Files\Google\Chrome\Application\chrome.exe` | **READY** | Windows App Path verified |
| **Package Engine** | npm / npx / pnpm | npx `11.13.0` / pnpm `10.x` | **READY** | Executable in PATH |
| **PostgreSQL Service** | Port 5432 Active | Listening on `0.0.0.0:5432` (PID 8072) | **READY** | NetTCPConnection confirmed |
| **Redis Service** | Port 6379 Active | Listening on `127.0.0.1:6379` (PID 5364) | **READY** | NetTCPConnection confirmed |
| **MinIO Object Store** | Port 9000 Active | Listening on `0.0.0.0:9000` (PID 17912) | **READY** | NetTCPConnection confirmed |
| **Web Server (Vite/Nitro)** | Port 3000 | Inactive (Cold) | **PENDING_APPROVAL** | Awaiting launch authorization |

---

## 2. Capability Mapping & Readiness Matrix (15 Audit Dimensions)

| # | Audit Capability | Mapped Skills | Available Tooling & Harnesses | Readiness Status | Operational Notes / Prerequisites |
|---|------------------|---------------|-------------------------------|:----------------:|-----------------------------------|
| 1 | **React Rendering Performance** | `react-performance`, `react-patterns`, `performance-profiler` | React DevTools Profiler API, AST static analysis (`static.mjs`), `startTransition` check | **READY** | Static rule matching is ready; runtime profiling requires running server. |
| 2 | **Vite Bundle Optimization** | `react-vite-best-practices`, `react-performance`, `web-perf-audit` | Vite CLI (`npm run build`), Rollup chunk analyzer, `npx vite-bundle-visualizer` | **READY** | Can analyze chunk boundaries and 800KB limits via standard read-only build. |
| 3 | **Frontend Runtime Profiling** | `web-performance`, `web-perf-audit`, `browser-testing-with-devtools` | Chrome DevTools Tracing, Long Animation Frames (LoAF), performance marks | **READY_WITH_SYNTHETIC** | Synthetic headless Chrome trace is ready. Chrome MCP requires external config. |
| 4 | **Browser Performance Testing** | `web-perf`, `performance-profiler`, `web-performance` | `npx -y lighthouse`, Chrome Headless with 4× CPU throttling & Slow 4G | **READY** | Mobile and Desktop Lighthouse audits execute keyless via npx. |
| 5 | **Playwright Automation** | `playwright` | `scripts/pwrun` harness, smoke delegation | **REQUIRES_SETUP** | `pwrun` toolchain verified; running suites requires `@playwright/test` install. |
| 6 | **Node.js CPU & Memory Profiling** | `nodejs-performance`, `performance-optimization` | Node built-in profiler (`--cpu-prof`, `--heap-prof`), priority rubric | **READY** | Native v26 V8 profiler flags available without additional packages. |
| 7 | **Event Loop Monitoring** | `nodejs-performance` | Event loop delay tracking, `perf_hooks` monitorEventLoopDelay | **READY** | Can be instrumented or observed during load testing via Node perf_hooks. |
| 8 | **PostgreSQL Query Performance** | `database-performance-tuning`, `postgresql-best-practices` | `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`, `pg_stat_statements`, `pg-diagnose.sh` | **READY** | Service active on port 5432; read-only EXPLAIN analysis ready to execute. |
| 9 | **Drizzle ORM Analysis** | `database-performance-tuning`, `api-and-interface-design` | Drizzle schema AST inspector, query logger inspection (`drizzle.config.ts`) | **READY** | Static inspection of Drizzle relational queries (`with: {...}`) for N+1 risks. |
| 10 | **Database Index Analysis** | `database-performance-tuning`, `postgresql-best-practices` | `pg_stat_user_indexes`, missing/unused index queries, GIN index audit | **READY** | 24 full-depth reference playbooks available for immediate diagnosis. |
| 11 | **Redis Performance** | `nodejs-performance` | `redis-cli` / Node `ioredis` connection pool inspection, pipeline check | **PARTIAL** | Core guidelines ready; Redis CLI latency monitoring available via local CLI. |
| 12 | **Socket.IO Performance** | `nodejs-performance`, `api-and-interface-design` | Event listener lifecycle analysis, serialization overhead audit | **PARTIAL** | Static code review ready; high-concurrency websocket load testing needs harness. |
| 13 | **API Latency Analysis** | `web-perf-audit`, `nodejs-performance` | `sampleTtfb` (`fetch.mjs`), `npx -y autocannon` (p50/p95/p99) | **READY** | TTFB sampler and autocannon load generation ready for local endpoints. |
| 14 | **Core Web Vitals** | `web-perf-audit`, `web-perf`, `web-performance` | Synthetic Lab Lighthouse + CrUX / PSI collectors (`crux.mjs`, `psi.mjs`) | **READY** | Lab metrics ready; Field p75 labeled `Info` in local dev as mandated by rubric. |
| 15 | **Memory Leak Detection** | `web-perf-audit`, `nodejs-performance` | Chrome Heap Snapshots (`take_heapsnapshot`), Node heapdump analysis | **READY** | Pre/post navigation heap comparison protocols documented in `DIAGNOSTICS.md`. |

---

## 3. Tool Execution Mechanisms & Fallback Paths

### 3.1 Synthetic Lab Testing vs Production RUM
- **Standard Protocol:** `web-perf-audit` dictates that field p75 (CrUX) is the ground truth.
- **Local Dev Adaptation:** Because the application is running locally without a public CrUX history, the audit engine will strictly report field metrics as `Info — not measured (local environment)` and utilize multi-run synthetic Lighthouse measurements (throttled 4× CPU, Slow 4G) labeled clearly as **Lab Data**. No numbers will be fabricated.

### 3.2 Automated E2E & Browser Control
- **Playwright Status:** The Python harness `pwrun` is verified and operational. When browser automation tests are authorized, `@playwright/test` and browser binaries can be installed in devDependencies.
- **Headless Chrome Direct Fallback:** In the absence of a registered Chrome MCP server, `npx lighthouse` and Chrome command-line remote debugging (`--headless --remote-debugging-port=9222`) serve as direct, zero-configuration alternatives that respect `CONFIGURATION_CHANGES: NONE`.

### 3.3 Database & Query Profiling
- **Safety Protocol:** Queries will use `EXPLAIN (ANALYZE, BUFFERS)` wrapped in `ROLLBACK` transactions where applicable, guaranteeing **zero data writes or modifications**.
- **Index Inspection:** Queries to `pg_stat_user_indexes` and `pg_stat_activity` provide non-intrusive metadata on sequential scans and lock contention.
