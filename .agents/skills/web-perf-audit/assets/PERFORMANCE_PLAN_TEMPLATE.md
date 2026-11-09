# Performance Implementation Plan — {{target}}

> Canonical plan skeleton. `scripts/report.mjs` fills this from the audit's findings.
> Replace every placeholder and delete this line.

Generated {{YYYY-MM-DD}} from `PERFORMANCE_AUDIT.md`. Every task carries the audit's issue ID; do not start one without re-reading its finding.

## Overview

| Phase | Focus | Tasks |
|---|---|---|
| 1 | Critical production issues | {{n}} |
| 2 | Core Web Vitals | {{n}} |
| 3 | Network & APIs | {{n}} |
| 4 | JavaScript & rendering | {{n}} |
| 5 | Assets (images, fonts, third party) | {{n}} |
| 6 | RUM & regression monitoring | {{n}} |

Rules for the whole plan: measure before and after every task; never break UI or business logic to win a metric; never add caching to hide a slow query; confirm each improvement in field data, not only in the lab.

## Phase 1 — Critical

Production issues affecting customers right now. Nothing else starts until these are done or explicitly deferred.

| # | Issue | Task | Affected | Files / components | Expected impact | Risk | Complexity | Verification |
|---|---|---|---|---|---|---|---|---|
| PERF-001 | `{{CHECK-ID}}` | {{the change}} | {{`/route` (mobile)}} | {{files or resources}} | {{quantified}} | {{risk + what to check}} | {{Low/Medium/High}} | {{lab signal + field metric}} |

## Phase 2 — Core Web Vitals

LCP, INP, CLS and TTFB work that did not already land in Phase 1.

## Phase 3 — Network & APIs

Waterfalls, endpoint latency, payload size, compression and caching correctness.

## Phase 4 — JavaScript & Rendering

Bundle size, hydration, execution cost and post-load runtime behaviour.

## Phase 5 — Assets

Images, fonts and third-party scripts.

## Phase 6 — RUM & Regression Monitoring

Continuous measurement, so the next regression is caught by a gate instead of by a customer.

| Standing | Task | Files / components | Expected impact | Risk | Complexity | Verification |
|---|---|---|---|---|---|---|
| RUM-1 | Ship a first-party web-vitals beacon with attribution and the dimensions in `references/RUM_IMPLEMENTATION.md` | app entry point, `/api/vitals` handler | Route- and device-level p75/p95 within days | Low — measurement only; collect no PII | Medium | Beacon rows arrive for every route with correct device/connection/deploy fields |
| RUM-2 | Add a per-deploy performance gate | CI pipeline, `scripts/budgets.mjs`, `scripts/compare.mjs` | Regressions fail the build instead of shipping | Low | Low | Deliberately regress a budget locally and confirm a non-zero exit |
| RUM-3 | Publish the dashboard: CWV p75 by route and device, trends, worst routes, deploy markers | dashboard/BI tool | One place that answers "did that deploy hurt?" | Low | Medium | Every panel in `references/BUDGETS_REGRESSION.md` renders from real data |

## Verification

For every completed task, record the comparison in the task's PR:

```text
Issue:     {{PERF-NNN / stable-id}}
Metric:    {{e.g. LCP p75, mobile, /products}}
Before:    {{value + source + date}}
After:     {{value + source + date}}
Change:    {{absolute + %}}
Confirmed: lab {{yes/no}} · field {{yes/no — note the 28-day CrUX window}}
```

A task is done when the lab audit no longer fires **and** the field metric moves. If the lab improves but the field does not, the diagnosis was wrong — reopen the finding.
