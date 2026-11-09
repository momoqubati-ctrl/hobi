# External references

Sources behind the thresholds, APIs and techniques this skill applies. Verify
against the live documentation — Core Web Vitals definitions and the APIs around
them change (FID → INP is the obvious recent example).

## Core Web Vitals

- Web Vitals overview — https://web.dev/articles/vitals
- LCP — https://web.dev/articles/lcp · Optimize LCP — https://web.dev/articles/optimize-lcp
- INP — https://web.dev/articles/inp · Optimize INP — https://web.dev/articles/optimize-inp
- CLS — https://web.dev/articles/cls · Optimize CLS — https://web.dev/articles/optimize-cls
- TTFB — https://web.dev/articles/ttfb · FCP — https://web.dev/articles/fcp
- Defining the thresholds — https://web.dev/articles/defining-core-web-vitals-thresholds
- Field measurement best practices — https://web.dev/articles/vitals-field-measurement-best-practices

## Field data

- Chrome UX Report — https://developer.chrome.com/docs/crux
- CrUX API — https://developer.chrome.com/docs/crux/api
- CrUX History API — https://developer.chrome.com/docs/crux/history-api
- CrUX methodology (28-day window, eligibility) — https://developer.chrome.com/docs/crux/methodology
- PageSpeed Insights API v5 — https://developers.google.com/speed/docs/insights/v5/get-started
- PSI vs CrUX vs Lighthouse — https://developers.google.com/speed/docs/insights/v5/about

## RUM instrumentation

- `web-vitals` library (attribution build) — https://github.com/GoogleChrome/web-vitals
- Attribution reference — https://github.com/GoogleChrome/web-vitals/blob/main/docs/attribution.md
- Long Animation Frames API — https://developer.chrome.com/docs/web-platform/long-animation-frames
- Server-Timing — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
- Navigation Timing — https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming
- Resource Timing — https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming
- Element Timing — https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming
- PerformanceObserver — https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver
- Network Information API — https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API
- Soft navigations (SPA metrics) — https://developer.chrome.com/docs/web-platform/soft-navigations-experiment

## Lab tooling

- Lighthouse — https://developer.chrome.com/docs/lighthouse/overview
- Lighthouse performance audits reference — https://developer.chrome.com/docs/lighthouse/performance
- Lighthouse CI — https://github.com/GoogleChrome/lighthouse-ci
- Chrome DevTools Performance panel — https://developer.chrome.com/docs/devtools/performance
- Performance insights & LCP breakdown — https://developer.chrome.com/docs/devtools/performance/reference
- chrome-devtools-mcp — https://github.com/ChromeDevTools/chrome-devtools-mcp
- Memory / heap snapshots — https://developer.chrome.com/docs/devtools/memory-problems

## Delivery, assets, network

- Preload, prefetch, preconnect — https://web.dev/articles/preload-critical-assets
- Priority Hints (`fetchpriority`) — https://web.dev/articles/fetch-priority
- Responsive images — https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Responsive_images
- Modern image formats — https://web.dev/articles/serve-images-webp
- Font best practices — https://web.dev/articles/font-best-practices
- `font-display` — https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- HTTP caching — https://web.dev/articles/http-cache
- Third-party script best practices — https://web.dev/articles/efficiently-load-third-party-javascript
- Third-party facades — https://web.dev/articles/third-party-facades

## Framework

- Next.js optimizing — https://nextjs.org/docs/app/guides/optimizing
- `next/image` — https://nextjs.org/docs/app/api-reference/components/image
- `next/font` — https://nextjs.org/docs/app/api-reference/components/font
- `next/script` — https://nextjs.org/docs/app/api-reference/components/script
- `useReportWebVitals` — https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals
- Bundle analyzer — https://nextjs.org/docs/app/guides/package-bundling
- Server and Client Components — https://nextjs.org/docs/app/getting-started/server-and-client-components
- React performance (`memo`, `useMemo`, `useCallback`) — https://react.dev/reference/react/memo

## Scheduling and main-thread work

- `scheduler.yield()` — https://developer.chrome.com/docs/web-platform/scheduler-yield
- Optimize long tasks — https://web.dev/articles/optimize-long-tasks
- `isInputPending()` — https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending
- Web Workers — https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API

## Budgets

- Performance budgets — https://web.dev/articles/performance-budgets-101
- size-limit — https://github.com/ai/size-limit
