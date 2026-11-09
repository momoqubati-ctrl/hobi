# Web Performance & RUM Audit — {{target}}

> Canonical report skeleton. `scripts/report.mjs` fills this automatically; the
> guidance layer refines the prose. Replace every placeholder and delete this line.

| | |
|---|---|
| **Target** | {{origin or repo path}} |
| **Date** | {{YYYY-MM-DD}} |
| **Mode** | {{Live URL | Codebase (static) | Live URL + codebase}} |
| **Routes audited** | {{n}} |
| **Field (RUM) data** | {{n CrUX record(s) [+ 25-week history] | PSI loading experience | no record — insufficient traffic | not measured}} |
| **Lab data** | {{n/n Lighthouse run(s) via PageSpeed Insights | not measured}} |
| **Runtime capture** | {{chrome-devtools MCP capture supplied | not measured}} |
| **Tooling** | {{node version, engine version}} |

## Executive Summary

- **Performance score:** {{0-100}}/100 ({{band}})
- **Findings:** {{c}} Critical · {{h}} High · {{m}} Medium · {{l}} Low · {{i}} Info
- **Priority:** {{n}} P0 · {{n}} P1 · {{n}} P2 · {{n}} P3

{{5–8 lines: current health from FIELD data first, the main bottleneck and its
root cause, mobile vs desktop difference, what to fix first. If no field data was
available, say that in the first sentence — every CWV verdict is then lab-only.}}

## Performance Scorecard

| Area | Status | Severity | Findings |
|---|---|---|---|
| LCP | {{Good / Needs improvement / Poor / Not measured}} | {{Critical/High/Medium/Low/—}} | {{n}} |
| INP | | | |
| CLS | | | |
| TTFB | | | |
| JavaScript | | | |
| APIs | | | |
| Images | | | |
| Fonts | | | |
| Caching | | | |
| Third Party | | | |
| Runtime | | | |
| RUM Coverage | | | |

_Status is derived from measurements only. **Not measured** means exactly that — it is never a pass._

## RUM Results

> Field percentiles, per route and per device. CrUX publishes **p75 only**: p50/p90
> may be shown as `approx` (histogram-derived) and p95/p99 are `not available`
> unless a first-party RUM stream supplied them. Never fill these cells with lab
> numbers or estimates.

**`{{/route}}` — {{mobile|desktop}}** · {{CrUX field (url-level) | PSI field (origin-level)}}

| Metric | p50 | p75 | p95 | Target | Status |
|---|---:|---:|---:|---:|---|
| LCP | {{v _approx_ | not available}} | **{{v}}** | not available | ≤ 2500ms | {{✅ Good / ⚠️ Needs improvement / ❌ Poor / Not measured}} |
| INP | | | | ≤ 200ms | |
| CLS | | | | ≤ 0.1 | |
| FCP | | | | ≤ 1800ms | |
| TTFB | | | | ≤ 800ms | |

_LCP distribution: {{n}}% good · {{n}}% needs improvement · {{n}}% poor._

**Segments not covered by CrUX** — browser (Chrome only), logged-in vs guest, country, deployment ID, new vs returning, and any authenticated or low-traffic route. Those require first-party RUM.

## Findings

> Grouped: site-wide first, then one `### \`/route\`` section per route. Findings are
> numbered `PERF-NNN` in priority order and also carry a stable check ID so two runs
> diff cleanly. No vague findings — name the route, the resource, the measured value,
> the target and the fix.

### Site-Wide

#### PERF-001 · `{{CHECK-ID}}` — {{title}}

| | |
|---|---|
| **Severity** | {{badge}} |
| **Priority** | {{P0–P3}} |
| **Area** | {{LCP / INP / CLS / TTFB / JavaScript / APIs / Images / Fonts / Caching / Third Party / Runtime / RUM Coverage}} |
| **Affected route** | {{site-wide | `/route`}} |
| **Affected devices** | {{mobile / desktop / all}} |
| **Observed metric** | {{what was measured}} |
| **Current value** | {{measured value}} |
| **Target value** | {{threshold}} |
| **Effort** | {{Low / Medium / High}} |
| **Source** | {{CrUX field data / Lighthouse lab run (PSI) / direct HTTP response / static source analysis / chrome-devtools MCP capture}} |

**Evidence**

```text
{{the actual measurement, header, audit output or trace excerpt}}
```

**Root cause:** {{why it happens — not a restatement of the symptom}}

**User impact:** {{what the user experiences}}

**Business impact:** {{why it is worth the engineering time}}

**Recommended fix:** {{the specific change}}

```{{lang}}
{{copy-pasteable fix}}
```

**Expected improvement:** {{quantified where the measurement supports it}}

---

### `{{/route}}`

{{finding blocks for this route}}

## Prioritization

> Every substantiated finding, ranked — not a top-10. Priority is computed as
> `impact × frequency × user exposure × fix confidence`.

| # | Priority | Severity | Area | Scope | Finding | Effort |
|---|---|---|---|---|---|---|
| PERF-001 | P0 | High | LCP | `/` | {{title}} | Low |

**Not measured / informational** (never scored, never treated as a pass):

- PERF-0NN · `{{CHECK-ID}}` — {{title}}

## Verification

| Step | Command / method | Closes on |
|---|---|---|
| Lab re-run | `node scripts/psi.mjs --url {{target}} --strategy both --out lab-after.json` | The audit that produced the finding no longer fires |
| Field re-check | `node scripts/crux.mjs --origin {{target}} --history --out field-after.json` | p75 moves into the target band (allow 28 days for the CrUX window) |
| Budget gate | `node scripts/budgets.mjs --measured field-after.json --budgets budgets.json` | Exit code 0 |
| Regression gate | `node scripts/compare.mjs --baseline baseline.json --current current.json` | No metric regressed beyond tolerance |

A Lighthouse improvement alone does not close a finding. Field p75 is the production signal.

## Appendix / Methodology

- **What was measured:** field — {{status}}; lab — {{status}}; runtime — {{status}}.
- **Thresholds:** LCP 2.5s/4s · INP 200ms/500ms · CLS 0.1/0.25 · FCP 1.8s/3s · TTFB 0.8s/1.8s.
- **Percentiles:** CrUX and PSI publish p75 only; p50/p90 shown as `approx` are interpolated from the three-bin histogram; p95/p99 are `not available`.
- **Scoring:** start at 100, subtract Critical −20 / High −10 / Medium −4 / Low −1, clamped 0–100. Info never scores.
- **Priority:** P0 ≥ 36, P1 ≥ 18, P2 ≥ 8, else P3; a Critical finding is never below P1.
- **Re-run:** `node scripts/run.mjs --url {{target}} --routes {{routes}} --out PERFORMANCE_AUDIT.md`
