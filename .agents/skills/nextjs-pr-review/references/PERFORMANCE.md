# Performance Review Reference

Performance guidance must be tied to the installed Next.js/React versions and the changed execution path. Never invent measurements.

## Server and client boundaries

- Prefer Server Components for non-interactive UI in App Router applications.
- Check whether a high-level `'use client'` directive unnecessarily pulls large subtrees or server-capable dependencies into the browser bundle.
- Do not move code server-side when it requires browser APIs or immediate client interaction.
- Inspect serialized props for oversized data and unnecessary fields.

## Data fetching and rendering

- Identify sequential awaits that create avoidable waterfalls; parallelize only independent work.
- Look for duplicate fetches, duplicate database calls, N+1 queries, and data fetched but not rendered.
- Verify pagination, limits, filtering, and streaming/Suspense placement for large or slow data.
- Determine static, dynamic, cached, and revalidated behavior from the installed Next.js version and configuration.
- Never recommend shared caching for personalized data unless authorization and cache keys are correct.
- Consider request time, cold starts, external service latency, database indexes, and payload serialization.

## Next.js 15/16 caching and rendering model

Verify behavior against the installed version before applying any of this — defaults changed across releases.

- In Next.js 15+, `fetch` requests are **not** cached by default, and Route Handlers (`GET` included) are dynamic by default. Code that relied on implicit caching may now hit the origin on every request; flag hot-path data that should opt into caching explicitly.
- Explicit caching primitives: `'use cache'` (function/file/component), `cacheLife` profiles, and `cacheTag` + `revalidateTag` for granular invalidation. Confirm cached scopes contain no per-user/per-tenant data unless the cache key includes the principal.
- Route segment config (`export const dynamic`, `revalidate`, `fetchCache`, `runtime`) and `unstable_cache` (legacy) still appear in codebases — interpret them in the context of the version in use.
- Partial Prerendering (`ppr`) lets a static shell stream dynamic holes; missing or misplaced `Suspense` boundaries can force a whole route dynamic. Flag `cookies()`/`headers()`/`connection()` reads pulled above a boundary that needlessly opt the route out of prerendering.
- `after()` runs work after the response streams; prefer it for logging/analytics/side effects rather than blocking the response path.
- `dynamicIO` (when enabled) makes uncached async work a build-time error unless wrapped in `'use cache'` or `Suspense`; account for it before recommending changes.
- The async request APIs (`cookies`, `headers`, `draftMode`, `params`, `searchParams`) return promises in 15+. Sequentially awaiting several independent ones can create a small waterfall; await in parallel where order is irrelevant.

## Browser bundle and third parties

- Inspect new dependencies and imports for client-bundle impact.
- Watch for broad barrel imports, browser-incompatible server libraries, duplicated libraries, and heavy modules loaded on initial routes.
- Use lazy loading/dynamic import when a large client-only feature is not needed for initial render; do not add it to tiny or server-rendered modules without benefit.
- Review analytics, chat, maps, editors, and other third-party scripts for loading strategy and main-thread cost.

## Images, fonts, and layout

- Use appropriately sized responsive images and preserve dimensions/aspect ratios.
- Prioritize only true above-the-fold/LCP assets; excessive priority/preload can compete with critical resources.
- Avoid layout shifts from missing dimensions, late content insertion, and font swaps.
- Review media preload, autoplay, codecs, poster/fallback behavior, and mobile payload size.
- Prefer built-in font handling where it fits the deployment and licensing requirements.

## React execution

- Detect render-time side effects, state-update loops, Effects used for derived data, and unstable list keys.
- Check expensive calculations repeated on each render and subscriptions/listeners without cleanup.
- Do not recommend `memo`, `useMemo`, or `useCallback` by default. Confirm an expensive calculation, unstable prop chain, or measured render problem.
- Inspect React Compiler configuration before recommending manual memoization; ensure Hook dependencies remain correct.
- Use virtualization or incremental rendering only for genuinely large lists where DOM/render cost is material.

## Core Web Vitals

Relate findings to the likely metric without claiming an exact score:

- **LCP**: delayed discovery, oversized hero media, render-blocking work, slow server response, or poor prioritization.
- **CLS**: missing dimensions, unstable placeholders, injected UI, or font/layout shifts.
- **INP**: long tasks, excessive JavaScript, synchronous heavy handlers, or large rerender cascades.

## Validation evidence

Useful evidence includes:

- Existing production build output and route rendering summary.
- Repository bundle analyzer output.
- React Profiler or browser Performance traces supplied or generated in an available environment.
- Query logs/explain plans supplied by the project.
- Lighthouse/Web Vitals data, clearly labeled as lab or field data.

Absence of measurements should reduce confidence, not prevent reporting obvious algorithmic or architectural regressions.

## Primary references

- Next.js Production Checklist: https://nextjs.org/docs/app/guides/production-checklist
- Next.js Image Optimization: https://nextjs.org/docs/app/getting-started/images
- Next.js Lazy Loading: https://nextjs.org/docs/app/guides/lazy-loading
- Next.js Data Fetching: https://nextjs.org/docs/app/getting-started/fetching-data
- React `memo`: https://react.dev/reference/react/memo
- React `useMemo`: https://react.dev/reference/react/useMemo
- React Components and Hooks Must Be Pure: https://react.dev/reference/rules/components-and-hooks-must-be-pure
- Web Vitals: https://web.dev/articles/vitals
