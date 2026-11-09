// Network: render-blocking resources, compression, caching, redirects,
// connection setup and the critical request chain. Evidence comes from the lab
// waterfall plus the response headers this skill fetched directly.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";
import { labFor, audit, headersFor } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];

export function run(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (lighthouse) out.push(...fromLab(ctx, route, device, lighthouse));
    }
    out.push(...fromHeaders(ctx, route));
  }
  return dedupe(out);
}

function fromLab(ctx, route, device, lighthouse) {
  const out = [];
  const exposure = device === "mobile" ? 4 : 2;

  const blocking = audit(lighthouse, "render-blocking-resources");
  const blockingMs = blocking?.overallSavingsMs ?? 0;
  if (blockingMs > 150) {
    out.push(
      finding({
        id: "NET-RENDER-BLOCKING",
        title: `Render-blocking resources delay first paint by ~${Math.round(blockingMs)}ms on \`${route}\` (${device})`,
        severity: blockingMs > 600 ? "high" : "medium",
        category: "lcp",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse render-blocking-resources",
        currentValue: `${Math.round(blockingMs)}ms`,
        targetValue: "no blocking resource above the critical CSS",
        evidence: topItems(blocking?.items, (i) => `${Math.round(Number(i.wastedMs) || 0)}ms — ${shortUrl(i.url)} (${fmtBytes(Number(i.totalBytes) || 0)})`),
        rootCause: "Stylesheets and synchronous scripts in the document head must be fetched, parsed and executed before the browser paints anything.",
        userImpact: "The screen stays blank while blocking resources load.",
        businessImpact: "Delays FCP and LCP together — the cheapest LCP win after image priority.",
        recommendation: "Inline the critical CSS, load the rest asynchronously, and mark non-critical scripts defer/async.",
        expectedImprovement: `~${Math.round(blockingMs)}ms earlier first paint.`,
        effort: "medium",
        fixSnippet: `<!-- Non-blocking stylesheet -->
<link rel="stylesheet" href="/non-critical.css" media="print" onload="this.media='all'">
<!-- Non-blocking script -->
<script src="/widget.js" defer></script>`,
        fixLang: "html",
        frequency: 4,
        exposure,
        confidence: 0.9,
        source: "psi-lab",
      }),
    );
  }

  const compression = audit(lighthouse, "uses-text-compression");
  const compressionBytes = compression?.overallSavingsBytes ?? 0;
  if (compressionBytes > 10 * 1024) {
    out.push(
      finding({
        id: "NET-NO-COMPRESSION",
        title: `Uncompressed text resources on \`${route}\` (${device})`,
        severity: "medium",
        category: "caching",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse uses-text-compression",
        currentValue: `${fmtBytes(compressionBytes)} recoverable`,
        targetValue: "gzip or brotli on every text response",
        evidence: topItems(compression?.items, (i) => `${shortUrl(i.url)} — ${fmtBytes(Number(i.totalBytes) || 0)} → saves ${fmtBytes(Number(i.wastedBytes) || 0)}`),
        rootCause: "Text responses are served without content encoding.",
        userImpact: "Multiples of the necessary bytes cross the network on every uncached load.",
        businessImpact: "A server/CDN configuration change with zero code risk.",
        recommendation: "Enable brotli (with gzip fallback) for HTML, CSS, JS, JSON and SVG at the edge or origin.",
        expectedImprovement: `${fmtBytes(compressionBytes)} less to download.`,
        effort: "low",
        fixSnippet: `# nginx
gzip on;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
brotli on;
brotli_types text/plain text/css application/javascript application/json image/svg+xml;`,
        fixLang: "nginx",
        frequency: 4,
        exposure,
        confidence: 0.95,
        source: "psi-lab",
      }),
    );
  }

  const cacheTtl = audit(lighthouse, "uses-long-cache-ttl");
  const cacheBytes = cacheTtl?.overallSavingsBytes ?? 0;
  if (cacheBytes > 100 * 1024) {
    out.push(
      finding({
        id: "NET-SHORT-CACHE-TTL",
        title: `Static assets served with short cache lifetimes on \`${route}\` (${device})`,
        severity: "medium",
        category: "caching",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse uses-long-cache-ttl",
        currentValue: `${fmtBytes(cacheBytes)} re-downloaded on repeat visits`,
        targetValue: "immutable, 1-year TTL on fingerprinted assets",
        evidence: topItems(cacheTtl?.items, (i) => `${shortUrl(i.url)} — TTL ${Math.round((Number(i.cacheLifetimeMs) || 0) / 1000)}s, ${fmtBytes(Number(i.totalBytes) || 0)}`),
        rootCause: "Fingerprinted build assets are served with a short or missing max-age, so returning visitors re-fetch them.",
        userImpact: "Repeat visits pay full download cost for assets that never change.",
        businessImpact: "Affects the returning-visitor segment, which is usually the segment that converts.",
        recommendation: "Serve content-hashed assets with `Cache-Control: public, max-age=31536000, immutable`. Keep HTML short-lived and revalidated.",
        expectedImprovement: `${fmtBytes(cacheBytes)} avoided per repeat visit.`,
        effort: "low",
        fixSnippet: `# Fingerprinted assets only (…/_next/static/**, /assets/app.9f2c1.js)
Cache-Control: public, max-age=31536000, immutable

# HTML
Cache-Control: public, max-age=0, must-revalidate`,
        fixLang: "http",
        frequency: 3,
        exposure,
        confidence: 0.9,
        source: "psi-lab",
      }),
    );
  }

  const preconnect = audit(lighthouse, "uses-rel-preconnect");
  if ((preconnect?.overallSavingsMs ?? 0) > 100) {
    out.push(
      finding({
        id: "NET-MISSING-PRECONNECT",
        title: `Late connection setup to required origins on \`${route}\` (${device})`,
        severity: "low",
        category: "lcp",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse uses-rel-preconnect",
        currentValue: `${Math.round(preconnect.overallSavingsMs)}ms in DNS/TCP/TLS`,
        targetValue: "connection warm before the request is issued",
        evidence: topItems(preconnect?.items, (i) => `${shortUrl(i.url)} — ${Math.round(Number(i.wastedMs) || 0)}ms`),
        rootCause: "Critical resources live on origins the browser only discovers mid-parse, paying DNS + TCP + TLS at the worst moment.",
        userImpact: "Hundreds of milliseconds of dead time before a critical asset even starts downloading.",
        businessImpact: "One line of HTML per origin.",
        recommendation: "Preconnect to the two or three origins that serve critical resources. Do not preconnect to everything — each one costs a connection.",
        expectedImprovement: `~${Math.round(preconnect.overallSavingsMs)}ms earlier start for those resources.`,
        effort: "low",
        fixSnippet: `<link rel="preconnect" href="https://cdn.example.com" crossorigin>
<link rel="dns-prefetch" href="https://cdn.example.com">`,
        fixLang: "html",
        frequency: 4,
        exposure,
        confidence: 0.8,
        source: "psi-lab",
      }),
    );
  }

  const chains = audit(lighthouse, "critical-request-chains");
  const chainLength = chains?.displayValue || "";
  if (chains && chains.score === 0 && chainLength) {
    out.push(
      finding({
        id: "NET-CRITICAL-CHAIN",
        title: `Sequential critical request chain on \`${route}\` (${device})`,
        severity: "medium",
        category: "lcp",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse critical-request-chains",
        currentValue: chainLength,
        targetValue: "critical resources requested in parallel from the initial HTML",
        evidence: `Lighthouse reports ${chainLength} on ${device}. Each level in the chain adds a full round trip before the next request can start.`,
        rootCause: "A resource can only be discovered after its parent has downloaded and been parsed — CSS importing CSS, JS fetching JS, or data fetched after hydration.",
        userImpact: "Load time grows with round-trip latency, which is exactly what mobile users have most of.",
        businessImpact: "Chains hurt worst on the slow connections where you are already losing users.",
        recommendation: "Flatten the chain: emit critical resources in the initial HTML, preload the level-2 resources, and fetch data on the server.",
        expectedImprovement: "Removing one chain level saves roughly one RTT (~50–300ms on mobile).",
        effort: "medium",
        fixSnippet: `<!-- Make the level-2 resource discoverable immediately -->
<link rel="preload" as="font" href="/fonts/inter.woff2" type="font/woff2" crossorigin>
<link rel="modulepreload" href="/_next/static/chunks/main.js">`,
        fixLang: "html",
        frequency: 4,
        exposure,
        confidence: 0.75,
        source: "psi-lab",
      }),
    );
  }

  const redirects = audit(lighthouse, "redirects");
  if ((redirects?.overallSavingsMs ?? 0) > 100) {
    out.push(
      finding({
        id: "NET-DOCUMENT-REDIRECTS",
        title: `Document redirect chain costs ~${Math.round(redirects.overallSavingsMs)}ms on \`${route}\` (${device})`,
        severity: "medium",
        category: "ttfb",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse redirects",
        currentValue: `${Math.round(redirects.overallSavingsMs)}ms`,
        targetValue: "a single response, no hops",
        evidence: topItems(redirects?.items, (i) => `${shortUrl(i.url)} — ${Math.round(Number(i.wastedMs) || 0)}ms`),
        rootCause: "The entry URL redirects before the real document is served, adding a full round trip to TTFB.",
        userImpact: "Every metric starts later, including LCP.",
        businessImpact: "Redirect chains most often hit campaign and search entry URLs — the highest-intent traffic.",
        recommendation: "Link to the final URL, collapse multi-hop chains into one, and terminate redirects at the edge.",
        expectedImprovement: `~${Math.round(redirects.overallSavingsMs)}ms off TTFB for affected entries.`,
        effort: "low",
        frequency: 4,
        exposure,
        confidence: 0.9,
        source: "psi-lab",
      }),
    );
  }

  const totalBytes = audit(lighthouse, "total-byte-weight");
  const budgetKb = ctx.budgets?.network?.totalKb ?? 1600;
  if (totalBytes?.numericValue != null && totalBytes.numericValue > budgetKb * 1024) {
    out.push(
      finding({
        id: "NET-PAGE-WEIGHT",
        title: `Page weight ${fmtBytes(totalBytes.numericValue)} on \`${route}\` (${device})`,
        severity: totalBytes.numericValue > budgetKb * 2 * 1024 ? "medium" : "low",
        category: "caching",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse total-byte-weight",
        currentValue: fmtBytes(totalBytes.numericValue),
        targetValue: `≤ ${budgetKb} KB`,
        evidence: `Total transferred: ${fmtBytes(totalBytes.numericValue)} on ${device} (budget ${budgetKb} KB). ${totalBytes.displayValue || ""}`.trim(),
        rootCause: "Cumulative asset weight across scripts, images, fonts and third parties.",
        userImpact: "Long loads and real data cost on metered mobile connections.",
        businessImpact: "Correlates with bounce on slow networks.",
        recommendation: "Work the per-category findings in this report; page weight is their sum, not a separate fix.",
        expectedImprovement: "Tracked as a budget rather than a single change.",
        effort: "medium",
        frequency: 4,
        exposure,
        confidence: 0.9,
        source: "psi-lab",
      }),
    );
  }

  return out;
}

/** Findings from the headers this skill fetched itself. */
function fromHeaders(ctx, route) {
  const out = [];
  const rec = headersFor(ctx, route);
  if (!rec) return out;
  const h = rec.headers || {};

  if (rec.redirects?.length) {
    out.push(
      finding({
        id: "NET-REDIRECT-CHAIN",
        title: `\`${route}\` responds through ${rec.redirects.length} redirect hop(s)`,
        severity: rec.redirects.length > 1 ? "medium" : "low",
        category: "ttfb",
        scope: "page",
        route,
        metric: "document redirect chain",
        currentValue: `${rec.redirects.length} hop(s)`,
        targetValue: "0 hops",
        evidence: rec.redirects.map((r) => `${r.status} ${r.from} → ${r.to}`).join("\n"),
        rootCause: "The requested URL is not the URL that finally serves the document.",
        userImpact: "Each hop adds a round trip before the server starts working.",
        businessImpact: "Hurts entry URLs shared in campaigns, search results and AI answers.",
        recommendation: "Update internal links to the canonical URL and collapse the chain to at most one hop.",
        expectedImprovement: "One RTT saved per removed hop.",
        effort: "low",
        frequency: 4,
        exposure: 4,
        confidence: 1,
        source: "headers",
      }),
    );
  }

  if (!h["content-encoding"] && rec.bytes > 5 * 1024) {
    out.push(
      finding({
        id: "NET-HTML-UNCOMPRESSED",
        title: `HTML for \`${route}\` is served without compression`,
        severity: "medium",
        category: "caching",
        scope: "page",
        route,
        metric: "Content-Encoding response header",
        currentValue: `no Content-Encoding, ${fmtBytes(rec.bytes)} of HTML`,
        targetValue: "br or gzip",
        evidence: `GET ${route} → ${rec.status}, ${fmtBytes(rec.bytes)} with no \`Content-Encoding\` header.`,
        rootCause: "The origin or CDN is not compressing the document response.",
        userImpact: "The document — the resource on the critical path — is several times larger than it needs to be.",
        businessImpact: "Directly inflates TTFB-to-FCP on every single visit.",
        recommendation: "Enable brotli/gzip for `text/html` at the edge.",
        expectedImprovement: "Typically 60–80% smaller HTML.",
        effort: "low",
        fixSnippet: `Content-Encoding: br
Vary: Accept-Encoding`,
        fixLang: "http",
        frequency: 4,
        exposure: 4,
        confidence: 0.95,
        source: "headers",
      }),
    );
  }

  if (!h["server-timing"]) {
    out.push(
      finding({
        id: "NET-NO-SERVER-TIMING",
        title: `No \`Server-Timing\` header on \`${route}\``,
        severity: "info",
        category: "rum",
        status: "info",
        scope: "page",
        route,
        metric: "Server-Timing response header",
        currentValue: "absent",
        targetValue: "server phases exposed to RUM",
        evidence: `Response headers for ${route} contain no \`Server-Timing\`.`,
        recommendation:
          "Emit Server-Timing (edge, app, db, cache) so TTFB can be attributed from the field instead of guessed. It is readable from `PerformanceNavigationTiming.serverTiming` in RUM.",
        fixSnippet: `Server-Timing: edge;dur=12, app;dur=210, db;dur=140, cache;desc="HIT"`,
        fixLang: "http",
        source: "headers",
      }),
    );
  }

  const ttfb = rec.ttfbMs;
  if (ttfb != null && ttfb > 1800) {
    out.push(
      finding({
        id: "TTFB-ORIGIN-SLOW",
        title: `Origin TTFB for \`${route}\` measured ${Math.round(ttfb)}ms`,
        severity: "high",
        category: "ttfb",
        scope: "page",
        route,
        metric: "measured document TTFB (single-location probe)",
        currentValue: `${Math.round(ttfb)}ms`,
        targetValue: "≤ 800ms",
        evidence: [
          `Direct fetch from the audit machine: TTFB ${Math.round(ttfb)}ms${rec.ttfbSamples?.length > 1 ? ` (samples: ${rec.ttfbSamples.map((n) => `${Math.round(n)}ms`).join(", ")})` : ""}.`,
          h["x-vercel-cache"] || h["cf-cache-status"] || h.age
            ? `Cache signals: ${["x-vercel-cache", "cf-cache-status", "age"].filter((k) => h[k]).map((k) => `${k}=${h[k]}`).join(", ")}.`
            : "No CDN cache-status header present — the response may be reaching the origin every time.",
        ].join("\n"),
        rootCause: "The server takes too long to produce the first byte. Attribute it (edge vs app vs database) before changing anything.",
        userImpact: "Nothing can render until this completes; it sets the floor for every other metric.",
        businessImpact: "A slow TTFB caps the best LCP the front end can possibly achieve.",
        recommendation: "Add Server-Timing, find the dominant phase, and fix that. Do not add a cache layer to hide a slow query — find the query first.",
        expectedImprovement: "Bringing TTFB under 800ms removes the same amount from LCP.",
        effort: "high",
        frequency: 4,
        exposure: 4,
        confidence: 0.6,
        source: "headers",
      }),
    );
  }

  return out;
}

function topItems(items, format, max = 5) {
  if (!Array.isArray(items) || !items.length) return "No per-resource detail returned by the lab run.";
  return items.slice(0, max).map((i, n) => `${n + 1}. ${format(i)}`).join("\n");
}

function shortUrl(u) {
  if (!u) return "(inline)";
  try {
    const { host, pathname } = new URL(String(u));
    return `${host}${pathname}`.slice(0, 120);
  } catch {
    return String(u).slice(0, 120);
  }
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.id}|${f.route}|${f.devices}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
