# RUM implementation — what to collect and how to segment it

Use this to review an existing RUM setup or design one. `assets/rum-collector.js`
is a working reference implementation; this document is the reasoning behind it.

## Metrics

Minimum viable set, all from the `web-vitals` **attribution** build:

| Metric | Why |
|---|---|
| LCP | Loading experience; a Core Web Vital |
| INP | Responsiveness; a Core Web Vital; **not measurable in the lab** |
| CLS | Visual stability; a Core Web Vital |
| FCP | Diagnoses LCP |
| TTFB | Caps everything else |

Plus, from the platform: Navigation Timing (DNS, TCP, TLS, request, response, DOM
processing, load), Resource Timing, Long Animation Frames, JS errors, failed
requests, API call duration, and soft-navigation route changes.

## Attribution — the part most implementations skip

Collecting `LCP = 3400` tells you a metric got worse. Collecting the attribution
tells you what to change. This is the difference between a dashboard and a tool.

- **LCP** → `element`, `url`, and the four subparts: `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay`.
- **INP** → `interactionTarget`, `interactionType`, `loadState`, and the three phases: `inputDelay`, `processingDuration`, `presentationDelay`, plus `longAnimationFrameEntries` (script source, invoker, forced style/layout).
- **CLS** → `largestShiftTarget`, `largestShiftValue`, `largestShiftTime`.
- **TTFB** → `waitingDuration`, `dnsDuration`, `connectionDuration`, `requestDuration`, `cacheDuration` — and the `Server-Timing` header your server emitted.

## Dimensions

Every beacon carries these, or the data cannot be segmented later:

| Dimension | Notes |
|---|---|
| **Route pattern** | `/orders/[id]`, never the resolved URL — groupable *and* PII-free |
| **Device type** | mobile / tablet / desktop |
| **Device capability** | `deviceMemory`, `hardwareConcurrency` — coarse buckets, the spec limits precision |
| **Connection** | `effectiveType`, `rtt`, `saveData` |
| **Browser / OS / version** | the segment CrUX cannot give you |
| **Country / region** | derive server-side from the request, never from geolocation APIs |
| **Navigation type** | navigate / reload / back_forward / prerender — cache state changes everything |
| **App version + deploy ID** | without this you cannot attribute a regression to a release |
| **Session type** | new vs returning, logged-in vs guest (as a flag, never an identifier) |

## Percentiles and segmentation

Averages hide the users you are losing. Report **p50, p75, p90, p95, p99** — and
treat **p75** as the production health signal for Core Web Vitals, because that is
what Google's thresholds are defined against.

Always segment before drawing a conclusion:

- by route — a site-wide p75 hides one catastrophic template
- by device — mobile and desktop are different products
- by connection — 4G vs 3G separates "our code is slow" from "their network is slow"
- by browser — a Safari-only regression is invisible in CrUX
- by deploy — the only way to answer "did that release hurt?"

Rule: **treat mobile as the primary target.** Good desktop numbers say nothing
about mobile, where CPU is 4–8× slower and latency is higher.

## Sampling

Start at 100%. Reduce only when volume forces it, and never below ~10% — sparse
tails make p95/p99 meaningless. Sample per **session**, not per beacon, or your
distributions skew. Keep the sample rate as a dimension so it can be corrected for.

## Privacy — non-negotiable

- No user identifiers, emails, names, or anything derived from them.
- No full URLs with query strings or path IDs; send the **route pattern**.
- No input values, no DOM text, no full referrers.
- Element attribution is a **selector**, not content.
- Respect consent where required; the beacon is measurement, but the rules still apply.
- Retain raw beacons only as long as the analysis needs; aggregate after that.

## Backend shape

One row per metric per page load:

```json
{
  "name": "INP", "value": 340, "rating": "needs-improvement", "id": "v4-1712…",
  "attribution": { "target": "button#add-to-cart", "inputDelay": 40,
                   "processingDuration": 250, "presentationDelay": 50 },
  "route": "/products/[slug]", "deviceType": "mobile", "effectiveType": "4g",
  "navigationType": "navigate", "appVersion": "2.4.0", "deployId": "abc123",
  "serverTiming": [{ "name": "app", "dur": 210 }], "timestamp": 1755792000000
}
```

Index on `(route, deviceType, name, timestamp)`. Compute percentiles in the query
layer; never store an average and throw the distribution away.

## Reviewing an existing setup

Ask, in this order:

1. Is **INP** collected at all? Many setups predate it and still report FID.
2. Is the **attribution** build in use, or only metric values?
3. Is **route** a pattern or a raw URL? Raw URLs make grouping impossible.
4. Is **deploy ID** present? Without it there is no regression story.
5. Are **percentiles** available, or only averages?
6. Is mobile reported **separately**?
7. Does anything **alert**, or is it a dashboard nobody opens?
