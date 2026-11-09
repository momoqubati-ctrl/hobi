# PERFORMANCE SKILLS INVENTORY

**Project Stack:** React 19.2 | Vite 8.0 | Node.js (v26.1) / Nitro 3.0 | PostgreSQL 16+ | Drizzle ORM | Redis (ioredis) | Socket.IO 4.8 | MinIO  
**Architectural Role:** Senior Performance Engineering Architect  
**Audit Status:** PRE-AUDIT READINESS & DISCOVERY (READ-ONLY)  
**Total Installed Skills:** 39  

---

## 1. Executive Summary

A comprehensive discovery and filesystem inspection was performed across all 39 agent skills installed in [`.agents/skills`](file:///d:/medo/hobi/.agents/skills). Every skill was inspected for:
1. Physical directory existence and integrity of `SKILL.md`.
2. Frontmatter metadata, operational guidelines, and scope boundaries.
3. Executable auxiliary scripts (`.mjs`, `.sh`, `.py`), test harnesses, and references.
4. Runtime dependencies (Node, Python, Bash, Git, external packages).
5. Compatibility with Google Antigravity execution model.

All 39 skills contain valid, parseable `SKILL.md` specifications. Twelve (12) skills directly govern performance, database optimization, runtime profiling, and end-to-end verification.

---

## 2. Complete Skills Directory & Verification Matrix

| # | Skill Name | Path | Primary Role | Executable Assets / Subdirectories | Antigravity Compatibility | Operational Status |
|---|------------|------|--------------|-----------------------------------|---------------------------|--------------------|
| 1 | `api-and-interface-design` | [Link](file:///d:/medo/hobi/.agents/skills/api-and-interface-design/SKILL.md) | REST/Nitro API contracts & boundaries | None (Markdown guide) | Native | Active |
| 2 | `browser-testing-with-devtools` | [Link](file:///d:/medo/hobi/.agents/skills/browser-testing-with-devtools/SKILL.md) | Chrome DevTools testing & DOM inspection | None (Instructions) | Native / MCP Dependent | Ready (Requires Chrome MCP or Headless) |
| 3 | `ci-cd-and-automation` | [Link](file:///d:/medo/hobi/.agents/skills/ci-cd-and-automation/SKILL.md) | Quality gates & pipeline architecture | None | Native | Active |
| 4 | `code-review-and-quality` | [Link](file:///d:/medo/hobi/.agents/skills/code-review-and-quality/SKILL.md) | Multi-axis static code review | None | Native | Active |
| 5 | `code-simplification` | [Link](file:///d:/medo/hobi/.agents/skills/code-simplification/SKILL.md) | Refactoring and complexity reduction | None | Native | Active |
| 6 | `constraint-driven-development` | [Link](file:///d:/medo/hobi/.agents/skills/constraint-driven-development/SKILL.md) | Quality contracts & anti-regression | `references/` | Native | Active |
| 7 | `context-engineering` | [Link](file:///d:/medo/hobi/.agents/skills/context-engineering/SKILL.md) | Agent session & context optimization | None | Native | Active |
| 8 | **`database-performance-tuning`** | [Link](file:///d:/medo/hobi/.agents/skills/database-performance-tuning/SKILL.md) | **PostgreSQL DBA diagnostics, EXPLAIN plans & indexes** | `scripts/pg-diagnose.sh`, `references/` | Native / Bash | **Ready (Verified)** |
| 9 | `debugging-and-error-recovery` | [Link](file:///d:/medo/hobi/.agents/skills/debugging-and-error-recovery/SKILL.md) | Root-cause analysis workflow | None | Native | Active |
| 10 | `deprecation-and-migration` | [Link](file:///d:/medo/hobi/.agents/skills/deprecation-and-migration/SKILL.md) | Schema expansion/contraction & migration safety | None | Native | Active |
| 11 | `documentation-and-adrs` | [Link](file:///d:/medo/hobi/.agents/skills/documentation-and-adrs/SKILL.md) | Architecture Decision Records | None | Native | Active |
| 12 | `doubt-driven-development` | [Link](file:///d:/medo/hobi/.agents/skills/doubt-driven-development/SKILL.md) | Adversarial review for critical paths | None | Native | Active |
| 13 | `frontend-ui-engineering` | [Link](file:///d:/medo/hobi/.agents/skills/frontend-ui-engineering/SKILL.md) | Accessible responsive UI engineering | None | Native | Active |
| 14 | `git-workflow-and-versioning` | [Link](file:///d:/medo/hobi/.agents/skills/git-workflow-and-versioning/SKILL.md) | Branching, atomic commits, releases | None | Native | Active |
| 15 | `graphify` | [Link](file:///d:/medo/hobi/.agents/skills/graphify/SKILL.md) | Knowledge graph analysis of codebase | Multiple Python scripts & exporters | Native / Python | Ready |
| 16 | `idea-refine` | [Link](file:///d:/medo/hobi/.agents/skills/idea-refine/SKILL.md) | Structured thinking & stress testing | `scripts/` | Native | Active |
| 17 | `incremental-implementation` | [Link](file:///d:/medo/hobi/.agents/skills/incremental-implementation/SKILL.md) | Thin verifiable slice implementation | None | Native | Active |
| 18 | `interview-me` | [Link](file:///d:/medo/hobi/.agents/skills/interview-me/SKILL.md) | Requirements clarification | None | Native | Active |
| 19 | **`nextjs-pr-review`** | [Link](file:///d:/medo/hobi/.agents/skills/nextjs-pr-review/SKILL.md) | React/Next.js PR security & performance check | `scripts/`, `references/`, `assets/` | Native / Shell | Ready |
| 20 | **`nodejs-performance`** | [Link](file:///d:/medo/hobi/.agents/skills/nodejs-performance/SKILL.md) | **Node.js latency, CPU/memory, event-loop lag** | None (Prescriptive playbook) | Native | **Ready (Verified)** |
| 21 | `observability-and-instrumentation` | [Link](file:///d:/medo/hobi/.agents/skills/observability-and-instrumentation/SKILL.md) | Metrics, tracing, logging standards | None | Native | Active |
| 22 | **`performance-optimization`** | [Link](file:///d:/medo/hobi/.agents/skills/performance-optimization/SKILL.md) | **Full-stack measure-before-optimizing methodology** | `references/` | Native | **Ready (Verified)** |
| 23 | **`performance-profiler`** | [Link](file:///d:/medo/hobi/.agents/skills/performance-profiler/SKILL.md) | **Lighthouse CLI, Core Web Vitals targets & bundle analysis** | None (CLI playbook) | Native | **Ready (Verified)** |
| 24 | `planning-and-task-breakdown` | [Link](file:///d:/medo/hobi/.agents/skills/planning-and-task-breakdown/SKILL.md) | Task breakdown & dependency ordering | None | Native | Active |
| 25 | **`playwright`** | [Link](file:///d:/medo/hobi/.agents/skills/playwright/SKILL.md) | **E2E browser automation & smoke harness** | `scripts/pwrun`, `templates/`, `tests/` | Native / Python | **Ready (Toolchain verified)** |
| 26 | **`postgresql-best-practices`** | [Link](file:///d:/medo/hobi/.agents/skills/postgresql-best-practices/SKILL.md) | **PostgreSQL indexing, query optimization, pooling** | `references/` (24 deep reference docs) | Native | **Ready (Full-depth verified)** |
| 27 | `pre-push-review` | [Link](file:///d:/medo/hobi/.agents/skills/pre-push-review/SKILL.md) | Pre-commit security & performance gating | `scripts/local-diff.sh`, `assets/` | Native / Bash | Ready |
| 28 | **`react-patterns`** | [Link](file:///d:/medo/hobi/.agents/skills/react-patterns/SKILL.md) | **React 19 patterns, use() hook, waterfall avoidance** | `references/` | Native | **Ready (Verified)** |
| 29 | **`react-performance`** | [Link](file:///d:/medo/hobi/.agents/skills/react-performance/SKILL.md) | **Re-render elimination, memoization, code-splitting** | `references/` | Native | **Ready (Verified)** |
| 30 | **`react-vite-best-practices`** | [Link](file:///d:/medo/hobi/.agents/skills/react-vite-best-practices/SKILL.md) | **23 Vite + React performance & build rules** | `rules/`, `AGENTS.md` | Native | **Ready (Verified)** |
| 31 | `security-and-hardening` | [Link](file:///d:/medo/hobi/.agents/skills/security-and-hardening/SKILL.md) | OWASP hardening, input sanitization, auth | `references/` | Native | Active |
| 32 | `shipping-and-launch` | [Link](file:///d:/medo/hobi/.agents/skills/shipping-and-launch/SKILL.md) | Pre-launch checklists & rollback plans | None | Native | Active |
| 33 | `source-driven-development` | [Link](file:///d:/medo/hobi/.agents/skills/source-driven-development/SKILL.md) | Official doc citation & anti-hallucination | None | Native | Active |
| 34 | `spec-driven-development` | [Link](file:///d:/medo/hobi/.agents/skills/spec-driven-development/SKILL.md) | PRDs & capability maps | None | Native | Active |
| 35 | `test-driven-development` | [Link](file:///d:/medo/hobi/.agents/skills/test-driven-development/SKILL.md) | Red-Green-Refactor test cycle | None | Native | Active |
| 36 | `using-agent-skills` | [Link](file:///d:/medo/hobi/.agents/skills/using-agent-skills/SKILL.md) | Meta-skill for skill discovery & dispatch | None | Native | Active |
| 37 | **`web-perf`** | [Link](file:///d:/medo/hobi/.agents/skills/web-perf/SKILL.md) | **Cloudflare Core Web Vitals & Lighthouse scoring** | `references/` | Native | **Ready (Verified)** |
| 38 | **`web-perf-audit`** | [Link](file:///d:/medo/hobi/.agents/skills/web-perf-audit/SKILL.md) | **Comprehensive hybrid audit engine (Node/Python)** | `scripts/` (13 scripts), `assets/`, `references/` | Native / Node / Python | **Ready (Selftest 100% Passed)** |
| 39 | **`web-performance`** | [Link](file:///d:/medo/hobi/.agents/skills/web-performance/SKILL.md) | **Main-thread scheduling, runtime traces, CLS/INP** | `BROWSER.md`, `MAIN-THREAD.md`, `RUNTIME-TRACE.md`, `LIGHTHOUSE-CI.md` | Native | **Ready (Verified)** |

---

## 3. Deep Dive: Core Performance & Database Skills

### 3.1 `web-perf-audit` (Orchestration Engine)
- **Path:** `d:\medo\hobi\.agents\skills\web-perf-audit`
- **Engine Type:** Hybrid (Deterministic Node.js checks + Python validator + Agent synthesis).
- **Tested Components:**
  - `scripts/selftest.mjs`: **PASSED**. Validated percentiles, Core Web Vitals thresholds, finding models, normalizers, and report rendering.
  - `scripts/validate-report.py`: **VERIFIED** on Python 3.14.5. Enforces report structural integrity and prevents unmeasured metrics from masquerading as passed.
  - `scripts/run.mjs`: Orchestrates URL-mode (field + lab + runtime) and Codebase-mode (static AST analysis).

### 3.2 `database-performance-tuning` & `postgresql-best-practices`
- **Paths:** `d:\medo\hobi\.agents\skills\database-performance-tuning`, `d:\medo\hobi\.agents\skills\postgresql-best-practices`
- **Scope:** PostgreSQL 14–17 query plans, table/index bloat, sequential scans, connection pooling, and JSONB GIN indexing.
- **Assets:** Complete 24 markdown reference guides covering partitioning, locks, replication, and query tuning. Includes `pg-diagnose.sh` for multi-axis DB inspection.

### 3.3 `react-performance` & `react-vite-best-practices`
- **Paths:** `d:\medo\hobi\.agents\skills\react-performance`, `d:\medo\hobi\.agents\skills\react-vite-best-practices`
- **Scope:** Build-time Vite optimizations (Rollup manualChunks, chunk size limits, asset inlining) and runtime React optimizations (re-render profiling, transitions, lazy evaluation). Contains 23 codified rules in `rules/`.

### 3.4 `nodejs-performance`
- **Path:** `d:\medo\hobi\.agents\skills\nodejs-performance`
- **Scope:** Event loop lag, p50/p95/p99 latency analysis, throughput bottlenecks, database/Redis connection pooling overhead, stream transformations, and serialization hot paths.

### 3.5 `playwright`
- **Path:** `d:\medo\hobi\.agents\skills\playwright`
- **Harness:** `scripts/pwrun` verified on Python 3.14.5.
- **Status:** CLI harness is functional (`pwrun doctor` passed toolchain discovery). Project-level dependencies (`@playwright/test`) are documented for installation upon authorization.
