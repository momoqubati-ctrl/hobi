# Core Web Vitals — thresholds and root-cause trees

Thresholds are Google's, applied to the **p75 of field data**, per device class.
A metric is `good` at or below the first number, `poor` above the second.

| Metric | Good | Needs improvement | Poor | What it measures |
|---|---:|---:|---:|---|
| **LCP** | ≤ 2.5s | 2.5–4s | > 4s | When the largest content element renders |
| **INP** | ≤ 200ms | 200–500ms | > 500ms | Worst-case interaction latency across the visit |
| **CLS** | ≤ 0.1 | 0.1–0.25 | > 0.25 | Unexpected layout movement |
| FCP | ≤ 1.8s | 1.8–3s | > 3s | First pixel of content |
| TTFB | ≤ 0.8s | 0.8–1.8s | > 1.8s | First byte of the document |

LCP, INP and CLS are the Core Web Vitals. FCP and TTFB are diagnostics: they
explain LCP, they are not goals in themselves.

**A metric is a symptom.** "LCP is 4.1s" is not a finding. "The LCP image on
`/products/[slug]` is lazy-loaded, so its request starts 900ms after the document,
and resource load delay is 62% of LCP" is a finding.

---

## LCP — the four subparts

Every LCP decomposes into exactly four phases. Fix the dominant one; the others
are noise until it is fixed. The `web-vitals` attribution build reports all four.

```
LCP = TTFB + resource load delay + resource load duration + element render delay
```

| Subpart | Typical share when healthy | Dominant means |
|---|---|---|
| **TTFB** | < 40% | Server, redirect chain, or no edge caching. Fix the server before the front end. |
| **Resource load delay** | < 10% | The LCP resource is discovered late — lazy loading, CSS background image, client-only render, or a request chain. |
| **Resource load duration** | < 40% | The image is too big, unoptimized, or on a slow/uncontended connection. |
| **Element render delay** | < 10% | The main thread is busy, a font is blocking text, or hydration must finish first. |

Decision tree:

1. **TTFB dominant** → `Server-Timing` to split edge/app/db; check redirects; check CDN cache-status headers. Do **not** add caching before knowing which phase is slow.
2. **Load delay dominant** → is the LCP element in the initial HTML? Is it `loading="lazy"`? Is it a CSS `background-image` (invisible to the preload scanner)? Is it rendered by a client component? Fix discoverability: `fetchpriority="high"`, `<link rel="preload" as="image">`, or `priority` on `next/image`.
3. **Load duration dominant** → responsive variants (`srcset`/`sizes`), AVIF/WebP, sane quality, and a CDN close to the user.
4. **Render delay dominant** → is the LCP text waiting on a webfont (`font-display: swap`)? Is the main thread blocked by hydration or a third-party script? Is the element behind a client-side data fetch?

If the LCP element is text, the fix is almost always font loading or main-thread
contention. If it is an image, it is almost always discovery or size.

---

## INP — the three phases

```
INP = input delay + processing duration + presentation delay
```

| Phase | Dominant means |
|---|---|
| **Input delay** | The main thread was already busy when the user tapped — hydration, a third-party script, or a long task from an earlier interaction. |
| **Processing duration** | Your event handler itself is slow — expensive state updates, synchronous work, large re-render trees. |
| **Presentation delay** | Rendering the result is slow — huge DOM, expensive style recalculation, non-composited animation, or a layout thrash inside the handler. |

Checks that follow from a dominant phase:

- **Input delay** → cut load-phase JavaScript; defer non-critical third parties; split long tasks; yield with `scheduler.yield()` or `setTimeout(0)`.
- **Processing** → memoize, batch state updates, move computation off the main thread (worker), debounce high-frequency handlers. In React: unstable dependencies, context providers re-rendering wide subtrees, and non-memoized list rows are the usual suspects.
- **Presentation** → shrink the affected subtree, virtualize lists, avoid reading layout (`offsetHeight`, `getBoundingClientRect`) after writing to the DOM in the same frame, animate only `transform`/`opacity`.

**Long Animation Frames (LoAF)** supersede Long Tasks for this work: a LoAF entry
names the scripts, their invokers and their forced style/layout cost, which is what
turns "a long task" into "this handler in this file".

---

## CLS — the sources

CLS accumulates over the whole visit, including after load. Session-window scoring
means one bad late shift can dominate.

Ranked by how often they cause a failing CLS:

1. Images, videos and iframes without `width`/`height` or `aspect-ratio`.
2. Banners, cookie notices, promo bars and ads injected **above** existing content.
3. Web fonts swapping with different metrics (fix with `font-display: optional`, or `size-adjust` / `ascent-override` on the fallback).
4. Content replacing a skeleton whose dimensions do not match the real content.
5. Lazy-loaded components that mount without reserved space.
6. Animating layout properties (`top`, `height`, `margin`) instead of `transform`.

The rule is one sentence: **reserve the space before the content arrives.** If an
element must be injected late, inject it into a box that was already there, or at
the bottom of the viewport where nothing moves under the reader.

---

## Lab vs field

| | Lab (Lighthouse) | Field (CrUX / RUM) |
|---|---|---|
| INP | not measured (TBT is the proxy) | measured |
| Device | one emulated profile | every real device |
| Network | one throttled profile | every real connection |
| Cache | cold | mixed |
| Consent-gated third parties | usually absent | present for consenting users |

A good Lighthouse score with a failing field metric is not a contradiction — it
means the lab profile does not represent the audience. Field data wins. Always.
