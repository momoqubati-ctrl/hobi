# Performance reference (stack-agnostic)

Look for work the change adds to a hot path, data it loads without bounds, or round-trips it could avoid. A
performance finding must name the affected path and the expected consequence. Mark unmeasured impact clearly and
never invent timings, query counts, or payload sizes.

## Data access

- **N+1 queries**: a query executed per item in a loop or per rendered row. Prefer batching, eager loading, or a
  single joined query.
- **Queries inside loops** and repeated/duplicate queries that could be hoisted, batched, or memoized within the
  request.
- **Over-fetching**: selecting all columns/fields when few are needed; loading whole relations to use one field.
- **Unbounded result sets**: loading an entire table/collection into memory instead of paginating, streaming,
  chunking, or using a cursor.
- **Missing indexes** for new filter/sort/join/foreign-key columns introduced by the change.

## Computation and algorithms

- Accidental quadratic (or worse) work: nested scans, repeated linear lookups that should be a map/set, re-sorting
  or re-computing inside a loop.
- Expensive work repeated instead of computed once; large in-memory transforms that could stream.
- Blocking/synchronous work on a request path (image processing, external API calls, crypto, large serialization)
  that should be async or queued.

## I/O, network, and payloads

- Sequential awaits / request waterfalls where independent calls can run in parallel.
- Chatty external calls without batching, timeouts, or connection reuse; missing pagination on outbound APIs.
- Oversized responses/payloads; serializing more than the client needs.

## Caching (correctness first)

- Add caching only for proven or obvious repeated expensive work — not speculatively.
- Cache keys must include the user/tenant when results are personalized; never place authorization-sensitive data
  behind a shared key.
- Verify invalidation on writes and sensible TTLs; a stale or over-shared cache is a correctness/security bug, not a
  speedup.

## Client and rendering (when applicable)

- Shipped bundle growth, heavy libraries, missing lazy/code-splitting, barrel-import side effects.
- Unnecessary re-renders, effects that re-run too often, unstable keys/identities, expensive work on every render.
- Asset handling (images/fonts/media) that harms load and layout stability.

## Validation evidence

Prefer measurements when available: query logs / EXPLAIN plans, profilers, build/bundle output, traces, or test
timing. Absence of measurement lowers confidence but does not block an obvious structural problem (e.g. a clear N+1).
State plainly when impact is reasoned rather than measured.

## Primary references

- Use the indexes — database query-planning and indexing guidance for your engine.
- Web Vitals — https://web.dev/articles/vitals (for user-facing rendering paths)
- Your framework's official caching, data-fetching, and pagination documentation for the installed version.
