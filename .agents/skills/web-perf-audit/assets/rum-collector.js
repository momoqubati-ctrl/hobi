/**
 * Drop-in first-party RUM collector — reference implementation.
 *
 * This file is an ASSET, not something the audit installs. Copy it into the
 * project, point BEACON_URL at your own endpoint, and delete what you do not use.
 *
 * Why not just use CrUX: CrUX is Chrome-only, p75-only, 28-day-lagged, and has no
 * data for low-traffic, authenticated or internal routes. This gives you every
 * percentile, per route, per device, per deploy, within minutes.
 *
 * Requires the attribution build:  npm i web-vitals
 * It is the attribution fields — not the metric value — that let you fix anything.
 *
 * Privacy: collect no PII. No URLs with query strings or path IDs that identify a
 * person, no user identifiers, no input contents, no full referrers. The route
 * pattern (`/orders/[id]`), not the resolved URL (`/orders/8842`).
 */

import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals/attribution';

const BEACON_URL = '/api/vitals';
const SAMPLE_RATE = 1.0;                                  // lower on very high traffic; never below ~0.1
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
const DEPLOY_ID = process.env.NEXT_PUBLIC_DEPLOY_ID || 'unknown';

const sampled = Math.random() < SAMPLE_RATE;

/** Stable dimensions attached to every beacon. Keep this list free of anything personal. */
function dimensions() {
  const nav = performance.getEntriesByType('navigation')[0];
  const conn = navigator.connection || {};
  return {
    route: routePattern(),                                 // '/products/[slug]', never the resolved id
    navigationType: nav?.type || 'unknown',                // navigate | reload | back_forward | prerender
    deviceType: matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop',
    deviceMemory: navigator.deviceMemory ?? null,          // coarse buckets only, per the spec
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    effectiveType: conn.effectiveType ?? null,             // '4g' | '3g' | …
    rtt: conn.rtt ?? null,
    saveData: conn.saveData ?? null,
    appVersion: APP_VERSION,
    deployId: DEPLOY_ID,
    serverTiming: serverTiming(nav),                       // TTFB attribution the server chose to expose
    timestamp: Date.now(),
  };
}

/** Route pattern rather than the resolved URL — the dimension you can group by, and PII-free. */
function routePattern() {
  // Next.js App Router: prefer the router's pattern if you have it in scope.
  // Fallback: mask numeric and uuid-like segments.
  return location.pathname
    .replace(/\/[0-9]+(?=\/|$)/g, '/[id]')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/[id]');
}

/** Server-Timing turns an opaque TTFB into named server phases. */
function serverTiming(nav) {
  if (!nav?.serverTiming?.length) return null;
  return nav.serverTiming.map((t) => ({ name: t.name, dur: t.duration, desc: t.description || null }));
}

/** One beacon per metric. sendBeacon survives the page unload that fires INP and CLS. */
function report(metric) {
  if (!sampled) return;
  const body = JSON.stringify({
    name: metric.name,                                     // LCP | INP | CLS | FCP | TTFB
    value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
    rating: metric.rating,                                 // good | needs-improvement | poor
    delta: metric.delta,
    id: metric.id,                                         // per-page-load metric id, not a user id
    attribution: attribution(metric),
    ...dimensions(),
  });
  if (navigator.sendBeacon?.(BEACON_URL, body)) return;
  fetch(BEACON_URL, { body, method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' } });
}

/**
 * The part that makes a regression diagnosable. Without these fields you know a
 * metric got worse; with them you know which element, which script, which phase.
 */
function attribution(metric) {
  const a = metric.attribution || {};
  switch (metric.name) {
    case 'LCP':
      return {
        element: a.target || null,                         // selector of the LCP element
        url: a.url || null,                                // the LCP resource
        // The four LCP subparts — fix whichever dominates, not "LCP" in the abstract.
        timeToFirstByte: round(a.timeToFirstByte),
        resourceLoadDelay: round(a.resourceLoadDelay),
        resourceLoadDuration: round(a.resourceLoadDuration),
        elementRenderDelay: round(a.elementRenderDelay),
      };
    case 'INP':
      return {
        target: a.interactionTarget || null,               // element the user actually hit
        type: a.interactionType || null,                   // pointer | keyboard
        // The three INP phases.
        inputDelay: round(a.inputDelay),
        processingDuration: round(a.processingDuration),
        presentationDelay: round(a.presentationDelay),
        loadState: a.loadState || null,
        longAnimationFrames: (a.longAnimationFrameEntries || []).slice(0, 3).map((f) => ({
          duration: round(f.duration),
          blockingDuration: round(f.blockingDuration),
          scripts: (f.scripts || []).slice(0, 3).map((s) => ({
            source: s.sourceURL || null,
            invoker: s.invoker || null,
            duration: round(s.duration),
            forcedStyleAndLayout: round(s.forcedStyleAndLayoutDuration),
          })),
        })),
      };
    case 'CLS':
      return {
        largestShiftTarget: a.largestShiftTarget || null,   // the element that moved
        largestShiftValue: a.largestShiftValue ?? null,
        largestShiftTime: round(a.largestShiftTime),
        loadState: a.loadState || null,
      };
    case 'TTFB':
      return {
        waitingDuration: round(a.waitingDuration),
        dnsDuration: round(a.dnsDuration),
        connectionDuration: round(a.connectionDuration),
        requestDuration: round(a.requestDuration),
        cacheDuration: round(a.cacheDuration),
      };
    case 'FCP':
      return {
        timeToFirstByte: round(a.timeToFirstByte),
        firstByteToFCP: round(a.firstByteToFCP),
        loadState: a.loadState || null,
      };
    default:
      return {};
  }
}

function round(v) {
  return v == null ? null : Math.round(v);
}

/** reportAllChanges keeps soft-navigation SPAs honest; drop it if your backend cannot dedupe by metric id. */
const options = { reportAllChanges: false };

onLCP(report, options);
onINP(report, options);
onCLS(report, options);
onFCP(report, options);
onTTFB(report, options);

/**
 * Long Animation Frames — the successor to Long Tasks. Reports the *frame* that
 * was slow along with the scripts responsible, so an INP regression can be traced
 * to a specific handler instead of "some long task".
 */
if (sampled && 'PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.blockingDuration < 50) continue;
      navigator.sendBeacon?.(
        BEACON_URL,
        JSON.stringify({
          name: 'LoAF',
          value: Math.round(entry.duration),
          blockingDuration: Math.round(entry.blockingDuration),
          scripts: (entry.scripts || []).slice(0, 3).map((s) => ({
            source: s.sourceURL || null,
            invoker: s.invoker || null,
            duration: Math.round(s.duration),
          })),
          ...dimensions(),
        }),
      );
    }
  }).observe({ type: 'long-animation-frame', buffered: true });
}
