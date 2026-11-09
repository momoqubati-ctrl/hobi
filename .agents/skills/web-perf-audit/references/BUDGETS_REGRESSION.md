# Budgets, dashboards and regression detection

An audit is a snapshot. This is how the numbers stay good after the audit is
closed: **Measure → Detect → Diagnose → Fix → Verify → Monitor → Detect regression.**

## Setting budgets

Start from the thresholds, then adapt to the architecture. A budget nobody can
hit gets ignored; a budget with no consequence is a comment.

```text
LCP p75      < 2.5s        INP p75  < 200ms      CLS p75  < 0.1
TTFB p75     < 800ms       FCP p75  < 1.8s

Initial JS   < 200 KB gzip     Route JS   < 300 KB gzip
Hero image   < 250 KB          Initial images  < 800 KB
Fonts        < 150 KB          Third-party blocking  < 150ms
Critical API p95  < 500ms
```

Rules that keep budgets alive:

1. Set them from **current p75**, not from an aspiration — then ratchet down.
2. Budget the **route**, not the site. One template's regression must not be averaged away.
3. Budget mobile **separately**. Desktop passing tells you nothing.
4. A breach must **fail something** — a build, a check, a review. Otherwise it is decoration.

`scripts/budgets.mjs` implements this: it exits non-zero on breach and reports a
budget with no measurement as `not measured`, never as a pass.

```bash
node scripts/budgets.mjs --measured snapshot.json --budgets budgets.json
```

## Per-deploy regression detection

```bash
node scripts/run.mjs --url https://example.com --deploy "$GIT_SHA" --work ./perf
node scripts/compare.mjs --baseline ./perf/baseline.json --current ./perf/snapshot.json --tolerance 0.1
```

`compare.mjs` diffs field p75, lab metrics and byte weights per route and device,
and exits non-zero when anything regresses beyond tolerance.

**Timing matters.** Field data moves on a 28-day rolling window, so a same-day
field comparison shows nothing. On deploy day the useful signals are lab metrics
and byte weights; field confirmation arrives over the following weeks. A report
that says "field unchanged" the day after a deploy is describing CrUX, not the deploy.

Example of a regression worth writing down:

```text
Deployment: abc123

LCP p75 (mobile, /products)
Before: 2.1s
After:  3.2s        +52%

Route JavaScript
Before: 420 KB
After:  590 KB      +40%

Suspected cause:
New product-gallery library adds 168 KB of client JavaScript that executes before LCP.
```

Name the change. "Performance regressed" is not a finding.

## CI wiring

```yaml
- run: npm run build
- run: node scripts/budgets.mjs --measured perf/snapshot.json --budgets budgets.json
- run: node scripts/compare.mjs --baseline perf/baseline.json --current perf/snapshot.json
```

Complementary tools worth adding:

- **Lighthouse CI** (`@lhci/cli`) — assertions on lab metrics per PR, with historical storage.
- **size-limit** — hard byte budgets on named bundles, in the PR diff.
- **Bundle analyzer in CI** — attach the treemap to the PR when a budget is breached; the reviewer sees *what* grew.

## Dashboard

The panels that get used, in the order they get looked at:

1. **Core Web Vitals p75** — LCP, INP, CLS, FCP, TTFB, split mobile vs desktop.
2. **Trend** — daily and weekly, with **deploy markers**. The inflection point names the culprit.
3. **Worst routes** — ranked by LCP, INP, CLS, TTFB, JS size and API latency. Not an average; a ranking.
4. **Device breakdown** — mobile / tablet / desktop side by side.
5. **Browser breakdown** — the one CrUX cannot give you; Safari-only regressions live here.
6. **Distribution, not just p75** — the share of good / needs-improvement / poor. A p75 that just crossed a threshold looks like a cliff; the distribution shows it was drifting for weeks.

Alert on **p75 crossing a threshold**, sustained over a window — not on a single
noisy sample, and not on averages.

## Verifying a fix

Every optimization gets the same record:

```text
Before / After / Improvement %   — in lab AND in field
```

A fix is not done because Lighthouse improved. It is done when real users are
faster. If the lab moved and the field did not, the diagnosis was wrong; reopen it.
