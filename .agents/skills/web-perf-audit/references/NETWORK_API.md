# Network and API performance

## The waterfall questions

For each route, in order:

1. **How many round trips before first paint?** Each level of a critical request chain costs one RTT — 50–300ms on mobile.
2. **Is anything blocking that should not be?** Synchronous scripts and non-critical stylesheets in `<head>`.
3. **Is anything requested twice?** Identical URLs in one page load.
4. **Is anything requested that is not used?** Fonts for weights never rendered, scripts for features not on this page.
5. **Is anything oversized?** Compare transferred bytes against what the page renders.
6. **Is the connection warm?** DNS + TCP + TLS to a critical third-party origin, discovered mid-parse.

## Caching that is actually correct

| Resource | Header | Why |
|---|---|---|
| Fingerprinted assets (`app.9f2c1.js`) | `Cache-Control: public, max-age=31536000, immutable` | The name changes when the content does |
| HTML | `Cache-Control: public, max-age=0, must-revalidate` | Must reflect the current deploy |
| API responses | `private, no-store` unless genuinely shareable | Personalized data in a shared cache is a security bug, not a perf win |
| Images from a CDN | Long TTL + a versioned path | Same reasoning as build assets |

Verify from the response, not the config: `cache-control`, `age`,
`x-vercel-cache`, `cf-cache-status`, `x-cache`. A missing cache-status header
usually means every request reaches the origin.

**Compression**: brotli with gzip fallback for HTML, CSS, JS, JSON and SVG. Do not
compress already-compressed formats (images, video, woff2). Always send
`Vary: Accept-Encoding`.

## TTFB attribution

An opaque TTFB is unfixable. Emit `Server-Timing` and it becomes a list of things
to fix:

```
Server-Timing: edge;dur=12, app;dur=310, db;dur=240, cache;desc="MISS"
```

Readable from the field via `PerformanceNavigationTiming.serverTiming`, so the
same split appears in RUM.

Order of investigation: redirects → edge/CDN cache → app framework overhead →
database/external calls. **Do not add a cache layer before you know which one is
slow.** Caching a slow query hides it until the cache misses, which is exactly when
traffic is highest.

## API performance

Measure endpoints individually and report:

```
endpoint · method · p50 · p75 · p95 · p99 · response size · error rate · calls per page load
```

A synthetic page load gives you **one sample per endpoint** — enough to spot a
1.4s call, not enough to claim a p95. Real percentiles come from server-side APM
or first-party RUM; the audit says so rather than dressing one sample up as a
distribution.

Flag:

| Pattern | Threshold | Usual cause |
|---|---|---|
| Slow endpoint | > 500ms | Unindexed query, external call, cold start |
| Very slow endpoint | > 1s | Missing index, N+1 in the handler, sequential external calls |
| Large payload | > 250KB | No pagination, returning every field |
| Duplicate calls | same URL twice per load | Two components fetching independently; unstable effect dependency |
| N+1 from the client | ≥ 5 calls to one pattern | Looping over a collection instead of batching |
| Front-end waterfall | request B starts after A resolves | Data fetched after hydration instead of on the server |

### Fixes that address the cause

- **N+1** → batch endpoint (`?ids=1,2,3`) or include the relation in the parent response.
- **Large payload** → paginate, and return only the fields the view renders (sparse fieldsets, or a GraphQL selection that matches the component).
- **Duplicates** → hoist the fetch to the server component/loader, or dedupe through a request cache (`React.cache`, a query client).
- **Waterfall** → fetch in parallel (`Promise.all`), or move the fetch to the server so it happens before the HTML is sent.
- **Slow query** → read the query plan. Add the index. Then, and only then, consider caching.

## Connection hints, used sparingly

```html
<link rel="preconnect" href="https://cdn.example.com" crossorigin>
<link rel="preload" as="image" href="/hero.avif" fetchpriority="high">
<link rel="modulepreload" href="/_next/static/chunks/main.js">
```

Each hint costs something: a preconnect holds a connection, a preload competes for
bandwidth with the resource it was meant to help. Two or three preconnects,
one or two preloads. More than that and you are reordering the queue, not shortening it.
