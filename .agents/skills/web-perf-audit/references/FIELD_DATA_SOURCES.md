# Field data sources — CrUX and PageSpeed Insights

Field data is what real users experienced. This skill's primary source is the
Chrome UX Report, reached two ways.

## 1. CrUX API (`scripts/crux.mjs`)

```
POST https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=API_KEY
{ "origin": "https://example.com", "formFactor": "PHONE",
  "metrics": ["largest_contentful_paint","interaction_to_next_paint",
              "cumulative_layout_shift","first_contentful_paint",
              "experimental_time_to_first_byte","round_trip_time"] }
```

- `origin` for site-wide aggregates, `url` for one page. Never both.
- `formFactor`: `PHONE` | `DESKTOP` | `TABLET`. Omit it for all devices combined.
- Response: `record.metrics.<name>.percentiles.p75` and a **three-bin** histogram (good / needs improvement / poor), plus `record.collectionPeriod` — a **28-day rolling window**.
- Requires a free API key. Get one in Google Cloud Console (enable "Chrome UX Report API").

**History** — `records:queryHistoryRecord` returns ~25 weekly p75 values plus
histograms. This is what powers the trend and regression findings; it is the only
free way to see whether a metric has been drifting.

## 2. PageSpeed Insights (`scripts/psi.mjs`)

```
GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed
    ?url=https://example.com&strategy=mobile&category=performance[&key=API_KEY]
```

One call returns both halves of the audit:

- `loadingExperience` / `originLoadingExperience` — **CrUX field data** for the URL and its origin. This is why field numbers are available even with no CrUX key.
- `lighthouseResult` — a full Lighthouse run: the audits this skill mines for JavaScript, network, image, font and third-party findings.

Works without a key at low volume; supply one for quota. `strategy=mobile` is the
default and the one that matters — run `desktop` too, but never instead.

## What CrUX cannot tell you

This is not a limitation to work around silently — it is the reason the RUM section
of the audit exists.

| Limitation | Consequence |
|---|---|
| **p75 only** | p50/p90 can only be *approximated* from the three-bin histogram (and are labelled `approx`); p95/p99 fall in the open-ended tail bin and are **not derivable**. `scripts/lib/percentiles.mjs` returns `null` rather than guessing. |
| **Chrome only** | No Safari, no Firefox. On an iPhone-heavy audience, CrUX describes a minority of visits. |
| **Public URLs only** | Nothing for staging, intranet, authenticated or low-traffic routes — the API returns `no-record`. |
| **28-day rolling window** | A fix shipped today will not fully appear for four weeks. Never conclude a fix failed from same-week CrUX data. |
| **Eligibility threshold** | Pages below a traffic floor have no URL-level record; the audit falls back to origin-level and says so. |
| **No custom dimensions** | No logged-in vs guest, no deploy ID, no country segmentation, no per-component attribution. |

When a target has no record, the audit reports the field section as
`Info — not measured` and every Core Web Vitals verdict becomes lab-only. That is
stated in the executive summary, not buried.

## Reading a `no-record` response

```json
{ "error": { "code": 404, "message": "chrome ux report data not found" } }
```

Causes, in order of likelihood: not enough traffic, URL not publicly reachable,
wrong protocol/host (`www` vs apex is a different origin), or the page is
behind auth. Check the origin-level record before concluding the site has no data.

## Closing the gaps

Everything CrUX cannot see is why `references/RUM_IMPLEMENTATION.md` and
`assets/rum-collector.js` exist. First-party RUM gives real percentiles, every
browser, every route, every deploy — within minutes rather than four weeks.
