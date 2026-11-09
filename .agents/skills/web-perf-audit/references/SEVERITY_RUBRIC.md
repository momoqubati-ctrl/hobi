# Severity, priority, scoring and IDs

How this skill rates what it finds. The engine (`scripts/lib/findings.mjs`) and the
human review layer apply this identically, so the same measurements always produce
the same numbers and two runs diff cleanly.

## Status

Every finding carries a status:

- **`fail`** — a substantiated defect, backed by a measurement. Only `fail` reduces the score.
- **`info`** — could not be measured, or context worth stating. **Zero** score impact.
- **`pass`** — verified good. Rarely emitted, never penalises.

Two rules the engine enforces in code, not by convention:

1. A `fail` finding **must** carry evidence — the constructor throws otherwise.
2. A metric that was not measured **cannot** be failed, and must never be rendered as a pass. `validate-report.py` re-checks this in the finished report.

## Severity

| Severity | Meaning | Example |
|---|---|---|
| `critical` | The route is effectively unusable for a substantial share of real users. | LCP p75 > 8s on mobile; the page cannot render without a failed third party. |
| `high` | A Core Web Vital is in the `poor` band, or a defect that clearly costs seconds. | INP p75 > 500ms; LCP image lazy-loaded; 600ms+ of third-party blocking. |
| `medium` | A metric in the `needs improvement` band, or a real inefficiency with measured cost. | LCP p75 3.2s; 300KB unused JS; missing compression. |
| `low` | Localized or low-urgency optimization. | Legacy polyfills; a non-composited hover animation. |
| `info` | Not measured, or context to confirm. Never scored. | No CrUX record; no MCP capture; RUM library detected. |

## Priority

Severity says how bad it is; priority says what to do first. Computed, not guessed:

```
score    = impact × frequency × user exposure × fix confidence

impact     critical 4 · high 3 · medium 2 · low 1
frequency  1–4  how often the affected path runs (every page load = 4)
exposure   1–4  share of real users hit (all devices = 4; mobile-only = 4 when mobile is the majority; desktop-only = 2; one browser = 2; edge case = 1)
confidence 0–1  diagnosis AND fix are certain = 1.0 · measured but the fix is architectural = 0.75 · heuristic/static = 0.5

P0 ≥ 36    P1 ≥ 18    P2 ≥ 8    otherwise P3
```

A `critical` finding is never below **P1**, regardless of how narrow its exposure.
Informational findings have no priority.

This is why mobile findings outrank their desktop twins: identical severity, higher
exposure.

## Scoring

One 0–100 performance score. Start at 100, subtract per `fail`:

```
critical −20   high −10   medium −4   low −1   info 0
```

| Score | Band |
|---|---|
| 90–100 | A — Excellent |
| 75–89 | B — Good |
| 60–74 | C — Needs work |
| 40–59 | D — Poor |
| 0–39 | F — Critical |

The score is a summary, not the deliverable. A score of 100 on a run where nothing
could be measured means nothing — which is why the executive summary leads with
whether field data existed at all.

## Scorecard status

Per area (LCP, INP, CLS, TTFB, JavaScript, APIs, Images, Fonts, Caching, Third
Party, Runtime, RUM Coverage):

- **Good** — the area was measured and nothing failed.
- **Needs improvement** — the worst failing finding is medium or low.
- **Poor** — the worst failing finding is high or critical.
- **Not measured** — no measurement was available, or only informational findings exist. *Not a pass.*

## Check-ID scheme

IDs are **stable strings**, not incrementing numbers, so reports diff cleanly.
Reports additionally show a sequential `PERF-NNN` in priority order for easy
reference in tickets; the stable ID is what tooling keys on.

| Prefix | Area |
|---|---|
| `CWV-` | Core Web Vitals field measurements and lab/field divergence |
| `LCP-` | LCP element and resource attribution |
| `CLS-` | Layout shift sources |
| `INP-` | Interaction latency and main-thread blocking |
| `TTFB-` | Server response time |
| `JS-` | Bundle weight, unused/duplicated/legacy code, execution |
| `NET-` | Waterfall, blocking resources, compression, caching, redirects |
| `API-` | Endpoint latency, payloads, duplicates, N+1 |
| `IMG-` | Image size, format, dimensions |
| `FONT-` | Font loading and weight |
| `TP-` | Third-party cost |
| `RUNTIME-` | Post-load behaviour: long tasks, transitions, memory, animation |
| `TREND-` | Degradation over the CrUX history window |
| `RUM-` | Field-data coverage and instrumentation gaps |
| `STATIC-` | Codebase-mode causes (never a runtime measurement) |
