// Core Web Vitals: field p75 first, lab attribution second, plus RUM coverage.
//
// Rule: a metric is only ever failed on a value we actually measured. When no
// field data exists the finding is `info` — "not measured" — and the audit says
// so, rather than promoting a lab number to a production verdict.

import { finding } from "../lib/findings.mjs";
import { THRESHOLDS, severityFor, rate, fmt } from "../lib/thresholds.mjs";
import { fieldFor, hasField, labFor, audit, auditItems, sourceLabel } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];
const CATEGORY = { lcp: "lcp", inp: "inp", cls: "cls", ttfb: "ttfb" };

const GUIDANCE = {
  lcp: {
    userImpact: "The main content takes too long to appear; the page feels slow before anything useful is readable.",
    businessImpact: "LCP is a ranking signal and correlates with bounce rate on entry pages.",
    recommendation: "Attribute LCP into TTFB / resource load delay / resource load duration / element render delay, then fix the dominant phase.",
    fixLang: "jsx",
    fixSnippet: `// Next.js: make the LCP image discoverable in the initial HTML and eagerly fetched
import Image from 'next/image';

<Image
  src={hero}
  alt="…"
  priority          // preloads + fetchpriority="high", disables lazy loading
  sizes="(max-width: 768px) 100vw, 1200px"
  width={1200}
  height={630}
/>`,
  },
  inp: {
    userImpact: "Taps and clicks do not paint a response quickly; the UI feels unresponsive after it looks ready.",
    businessImpact: "INP is a Core Web Vital and directly affects interaction-heavy conversion steps.",
    recommendation: "Capture an INP attribution trace and split the interaction into input delay / processing duration / presentation delay, then break up whichever phase dominates.",
    fixLang: "js",
    fixSnippet: `// Yield to the main thread between chunks of work so input can be painted.
async function runChunked(items, work) {
  for (const item of items) {
    work(item);
    if (navigator.scheduling?.isInputPending?.()) {
      await new Promise((r) => setTimeout(r, 0)); // or scheduler.yield()
    }
  }
}`,
  },
  cls: {
    userImpact: "Content moves under the user's finger or cursor, causing mis-taps and lost reading position.",
    businessImpact: "Layout instability is a Core Web Vital and a common cause of accidental clicks on ads or CTAs.",
    recommendation: "Reserve space for every element that arrives late — images, embeds, banners, fonts and injected content.",
    fixLang: "css",
    fixSnippet: `/* Reserve the box before the asset arrives */
img, video, iframe { aspect-ratio: attr(width) / attr(height); }
.banner-slot { min-height: 90px; }        /* reserve ad/banner space */
@font-face { font-display: optional; }     /* no swap-driven reflow */`,
  },
  ttfb: {
    userImpact: "Every other metric starts late because the server takes too long to send the first byte.",
    businessImpact: "TTFB caps the best achievable LCP and inflates crawl cost.",
    recommendation: "Split TTFB with Server-Timing (redirect, edge, app, database) and fix the dominant segment before adding caching.",
    fixLang: "http",
    fixSnippet: `# Emit Server-Timing so TTFB can be attributed instead of guessed
Server-Timing: edge;dur=12, app;dur=310, db;dur=240, cache;desc="MISS"`,
  },
};

export function run(ctx) {
  const findings = [];

  if (!hasField(ctx)) {
    findings.push(
      finding({
        id: "RUM-FIELD-UNAVAILABLE",
        title: "No field (RUM) data available for this target",
        severity: "info",
        category: "rum",
        status: "info",
        metric: "CrUX / PSI field data",
        currentValue: "not measured",
        targetValue: "p75 for LCP, INP, CLS on both phone and desktop",
        evidence: ctx.field?.available === false
          ? "No CrUX API key supplied and PageSpeed Insights returned no loadingExperience for this origin."
          : "CrUX returned no record for this origin or its routes (insufficient public traffic, or the target is not publicly reachable).",
        recommendation:
          "Treat every Core Web Vitals verdict in this report as lab-only. For a target CrUX cannot see (staging, intranet, auth-gated, low traffic), stand up first-party RUM — see references/RUM_IMPLEMENTATION.md — and re-run once real p75 values exist.",
        source: "crux",
      }),
    );
  }

  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const field = fieldFor(ctx, route, device);
      if (!field) continue;

      if (field.scope === "origin") {
        findings.push(
          finding({
            id: "RUM-ROUTE-FIELD-MISSING",
            title: `No route-level field data for \`${route}\` (${device})`,
            severity: "info",
            category: "rum",
            status: "info",
            scope: "page",
            route,
            devices: device,
            metric: "CrUX URL-level record",
            currentValue: "origin-level data substituted",
            targetValue: "URL-level p75",
            evidence: `CrUX has no URL-level record for ${route} (${device}); origin-level aggregates were used instead.`,
            recommendation:
              "Origin aggregates hide per-route regressions. Segment by route in first-party RUM to get route-level p75.",
            source: field.source,
          }),
        );
      }

      for (const metric of ["lcp", "inp", "cls", "ttfb"]) {
        const value = field.metrics?.[metric]?.p75;
        if (value == null) continue;
        const severity = severityFor(metric, value);
        if (!severity) continue;

        const t = THRESHOLDS[metric];
        const dist = field.metrics[metric].distribution;
        const g = GUIDANCE[metric];
        findings.push(
          finding({
            id: `CWV-${metric.toUpperCase()}-P75`,
            title: `${t.label} p75 is ${rate(metric, value)} on ${device} for \`${route}\``,
            severity,
            category: CATEGORY[metric],
            scope: "page",
            route,
            devices: device,
            metric: `${t.label} p75 (${device}, field)`,
            currentValue: fmt(metric, value),
            targetValue: `≤ ${fmt(metric, t.good)}`,
            evidence: [
              `${sourceLabel(field)} — ${t.label} p75 = ${fmt(metric, value)} (target ≤ ${fmt(metric, t.good)}, poor > ${fmt(metric, t.poor)}).`,
              dist
                ? `Distribution: ${pct(dist.good)} good · ${pct(dist.needsImprovement)} needs improvement · ${pct(dist.poor)} poor.`
                : null,
              field.collectionPeriod
                ? `Collection period ends ${isoDate(field.collectionPeriod.lastDate)} (28-day rolling window).`
                : null,
              labAttribution(ctx, route, device, metric),
            ]
              .filter(Boolean)
              .join("\n"),
            rootCause: labAttribution(ctx, route, device, metric) || "Not derivable from field data alone — capture a trace (chrome-devtools MCP) on the affected device class to attribute the metric.",
            userImpact: g.userImpact,
            businessImpact: g.businessImpact,
            recommendation: g.recommendation,
            expectedImprovement: `Bring ${t.label} p75 under ${fmt(metric, t.good)} on ${device}.`,
            effort: metric === "ttfb" ? "high" : "medium",
            fixSnippet: g.fixSnippet,
            fixLang: g.fixLang,
            frequency: metric === "inp" ? 3 : 4,
            exposure: device === "mobile" ? 4 : 2,
            confidence: 0.9,
            source: field.source,
          }),
        );
      }

      const divergence = labFieldDivergence(ctx, route, device, field);
      if (divergence) findings.push(divergence);
    }
  }

  findings.push(...lcpElementFindings(ctx));
  findings.push(...clsElementFindings(ctx));
  findings.push(...blockingTimeFindings(ctx));
  findings.push(...trendFindings(ctx));
  return findings;
}

/** Lab says good, field says poor → the lab profile does not represent real users. */
function labFieldDivergence(ctx, route, device, field) {
  const lighthouse = labFor(ctx, route, device);
  const labLcp = lighthouse?.metrics?.lcp;
  const fieldLcp = field.metrics?.lcp?.p75;
  if (labLcp == null || fieldLcp == null) return null;
  if (!(rate("lcp", labLcp) === "good" && rate("lcp", fieldLcp) !== "good")) return null;

  return finding({
    id: "CWV-LAB-FIELD-DIVERGENCE",
    title: `Lab LCP passes but field LCP fails on ${device} for \`${route}\``,
    severity: "info",
    category: "rum",
    status: "info",
    scope: "page",
    route,
    devices: device,
    metric: "lab LCP vs field LCP p75",
    currentValue: `lab ${fmt("lcp", labLcp)} vs field ${fmt("lcp", fieldLcp)}`,
    targetValue: "field p75 ≤ 2500ms",
    evidence: `Lighthouse (${device}) measured LCP ${fmt("lcp", labLcp)}; ${sourceLabel(field)} p75 is ${fmt("lcp", fieldLcp)}.`,
    recommendation:
      "Do not close the metric on the lab result. Real users differ in device class, network, cache state, geography and consent-gated third parties. Reproduce with 4x CPU throttling and Slow 4G, and check the field distribution by device.",
    source: "psi",
  });
}

/** What Lighthouse says about the metric on this route, if anything. */
function labAttribution(ctx, route, device, metric) {
  const lighthouse = labFor(ctx, route, device);
  if (!lighthouse) return null;
  if (metric === "lcp") {
    const el = audit(lighthouse, "largest-contentful-paint-element");
    const node = el?.items?.[0]?.node || el?.items?.[0]?.snippet || el?.items?.[0]?.selector;
    return node ? `Lab LCP element (${device}): ${truncate(String(node), 200)}` : null;
  }
  if (metric === "inp") {
    const tbt = lighthouse.metrics?.tbt;
    return tbt == null ? null : `Lab total blocking time (${device}): ${Math.round(tbt)}ms.`;
  }
  if (metric === "cls") {
    const shift = auditItems(lighthouse, "layout-shift-elements")[0];
    return shift ? `Largest lab layout shift: ${truncate(String(shift.node || shift.snippet || shift.selector || ""), 160)}` : null;
  }
  if (metric === "ttfb") {
    const srt = lighthouse.metrics?.ttfb;
    return srt == null ? null : `Lab server response time (${device}): ${Math.round(srt)}ms.`;
  }
  return null;
}

/** The LCP element itself: lazy-loaded, unprioritized, or discovered late. */
function lcpElementFindings(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (!lighthouse) continue;

      const lazy = audit(lighthouse, "lcp-lazy-loaded");
      if (lazy && lazy.score === 0) {
        out.push(
          finding({
            id: "LCP-IMAGE-LAZY",
            title: `LCP image is lazy-loaded on \`${route}\` (${device})`,
            severity: "high",
            category: "lcp",
            scope: "page",
            route,
            devices: device,
            metric: "Lighthouse lcp-lazy-loaded",
            currentValue: "loading=\"lazy\" on the LCP element",
            targetValue: "eager + high fetch priority",
            evidence: `Lighthouse audit \`lcp-lazy-loaded\` failed on ${device}: ${truncate(String(lazy.items?.[0]?.node || lazy.displayValue || "the LCP image is deferred by lazy loading"), 220)}`,
            rootCause: "The largest above-the-fold image is deferred until layout runs, so its request starts after the browser has already parsed and laid out the page.",
            userImpact: "The hero image — the thing the page is about — arrives hundreds of milliseconds later than it needs to.",
            businessImpact: "Directly inflates LCP, the metric Google uses for loading experience.",
            recommendation: "Remove lazy loading from the LCP element and mark it high priority. Lazy-load only what is below the fold.",
            expectedImprovement: "Typically 200–800ms off LCP on mobile.",
            effort: "low",
            fixSnippet: `<!-- Before -->
<img src="/hero.jpg" loading="lazy" alt="…">

<!-- After -->
<img src="/hero.jpg" fetchpriority="high" decoding="async" width="1200" height="630" alt="…">
<!-- Next.js: <Image priority … /> does this for you -->`,
            fixLang: "html",
            frequency: 4,
            exposure: device === "mobile" ? 4 : 2,
            confidence: 1,
            source: "psi-lab",
          }),
        );
      }

      const prioritize = audit(lighthouse, "prioritize-lcp-image");
      if (prioritize && prioritize.score !== null && prioritize.score < 1) {
        const savings = prioritize.overallSavingsMs;
        out.push(
          finding({
            id: "LCP-IMAGE-UNPRIORITIZED",
            title: `LCP image is discovered late on \`${route}\` (${device})`,
            severity: savings && savings > 500 ? "high" : "medium",
            category: "lcp",
            scope: "page",
            route,
            devices: device,
            metric: "Lighthouse prioritize-lcp-image",
            currentValue: savings ? `${Math.round(savings)}ms potential saving` : prioritize.displayValue || "not prioritized",
            targetValue: "LCP resource requested in the first wave",
            evidence: `Lighthouse audit \`prioritize-lcp-image\` on ${device}: ${prioritize.displayValue || "the LCP image is not preloaded or prioritized"}${savings ? ` (estimated ${Math.round(savings)}ms saving)` : ""}.`,
            rootCause: "The LCP resource is only discoverable after CSS/JS has been parsed — often because it is set by a client component, a CSS background, or an image CDN redirect.",
            userImpact: "The most important pixel on the page waits behind lower-value work.",
            businessImpact: "One of the cheapest LCP wins available; it is pure request ordering.",
            recommendation: "Emit the LCP image in the server-rendered HTML with fetchpriority=\"high\", or preload it. Never load it from CSS or a client-only component.",
            expectedImprovement: savings ? `~${Math.round(savings)}ms off LCP.` : "Meaningful LCP reduction on slow connections.",
            effort: "low",
            fixSnippet: `<link rel="preload" as="image" href="/hero.avif" fetchpriority="high"
      imagesrcset="/hero-800.avif 800w, /hero-1600.avif 1600w"
      imagesizes="(max-width: 768px) 100vw, 1200px">`,
            fixLang: "html",
            frequency: 4,
            exposure: device === "mobile" ? 4 : 2,
            confidence: 0.9,
            source: "psi-lab",
          }),
        );
      }
    }
  }
  return dedupe(out);
}

/** Elements that actually shifted, straight from the lab run. */
function clsElementFindings(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (!lighthouse) continue;
      const items = auditItems(lighthouse, "layout-shift-elements");
      const labCls = lighthouse.metrics?.cls;
      if (!items.length || labCls == null || labCls <= THRESHOLDS.cls.good) continue;

      out.push(
        finding({
          id: "CLS-SHIFTING-ELEMENTS",
          title: `${items.length} element(s) shift during load on \`${route}\` (${device})`,
          severity: severityFor("cls", labCls) || "medium",
          category: "cls",
          scope: "page",
          route,
          devices: device,
          metric: "Lighthouse layout-shift-elements",
          currentValue: `lab CLS ${fmt("cls", labCls)}`,
          targetValue: "≤ 0.1",
          evidence: items
            .slice(0, 5)
            .map((i, n) => `${n + 1}. ${truncate(String(i.node || i.snippet || i.selector || "element"), 160)}${i.score ? ` (score ${Number(i.score).toFixed(3)})` : ""}`)
            .join("\n"),
          rootCause: "These elements are inserted or resized after first paint without reserved space.",
          userImpact: "Content jumps while the user is reading or reaching for a control.",
          businessImpact: "CLS is a Core Web Vital and a frequent source of accidental clicks.",
          recommendation: "Give each listed element explicit dimensions or a reserved container before its content arrives.",
          expectedImprovement: "Removing the largest contributor usually brings CLS under 0.1.",
          effort: "low",
          fixSnippet: `/* Reserve the space the late element will occupy */
.hero-media { aspect-ratio: 16 / 9; }
.notice-slot { min-height: 48px; }`,
          fixLang: "css",
          frequency: 4,
          exposure: device === "mobile" ? 4 : 2,
          confidence: 0.85,
          source: "psi-lab",
        }),
      );
    }
  }
  return dedupe(out);
}

/** Main-thread blocking — the lab proxy for INP risk. */
function blockingTimeFindings(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      const tbt = lighthouse?.metrics?.tbt;
      if (tbt == null || tbt <= 200) continue;
      const longTasks = auditItems(lighthouse, "long-tasks");

      out.push(
        finding({
          id: "INP-MAIN-THREAD-BLOCKING",
          title: `${Math.round(tbt)}ms total blocking time on \`${route}\` (${device})`,
          severity: tbt > 600 ? "high" : "medium",
          category: "inp",
          scope: "page",
          route,
          devices: device,
          metric: "Lighthouse total blocking time",
          currentValue: `${Math.round(tbt)}ms`,
          targetValue: "≤ 200ms",
          evidence: [
            `Total blocking time (${device}): ${Math.round(tbt)}ms.`,
            longTasks.length
              ? `Longest tasks:\n${longTasks.slice(0, 5).map((t) => `  ${Math.round(Number(t.duration) || 0)}ms — ${truncate(String(t.url || "unattributed"), 120)}`).join("\n")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
          rootCause: longTasks.length
            ? "Long tasks from the scripts listed above occupy the main thread, so input cannot be handled or painted promptly."
            : "Main-thread work exceeds the blocking-time budget; attribute it with a trace to name the scripts.",
          userImpact: "Interactions during and shortly after load feel stuck.",
          businessImpact: "Blocking time is the strongest lab predictor of a failing INP in the field.",
          recommendation: "Split or defer the listed scripts, move work off the main thread, and yield between chunks. Confirm the improvement against field INP, not TBT alone.",
          expectedImprovement: "Reducing blocking time below 200ms typically moves INP p75 into the good band.",
          effort: "medium",
          fixSnippet: `// Defer non-critical work until the browser is idle, and split what must run.
const Heavy = dynamic(() => import('./HeavyWidget'), { ssr: false });
requestIdleCallback(() => import('./analytics').then((m) => m.init()));`,
          fixLang: "js",
          frequency: 3,
          exposure: device === "mobile" ? 4 : 2,
          confidence: 0.8,
          source: "psi-lab",
        }),
      );
    }
  }
  return dedupe(out);
}

/** 25-week CrUX history: has p75 degraded materially? */
function trendFindings(ctx) {
  const history = ctx.field?.history;
  if (!history || history.status !== "ok") return [];
  const out = [];
  for (const [metric, series] of Object.entries(history.series || {})) {
    if (!THRESHOLDS[metric] || !Array.isArray(series) || series.length < 9) continue;
    const latest = series[series.length - 1];
    const past = series[series.length - 9]; // ~8 weeks earlier
    if (latest == null || past == null || past <= 0) continue;
    const change = (latest - past) / past;
    if (change < 0.2) continue;

    out.push(
      finding({
        id: `TREND-${metric.toUpperCase()}-REGRESSION`,
        title: `${THRESHOLDS[metric].label} p75 degraded ${Math.round(change * 100)}% over ~8 weeks`,
        severity: rate(metric, latest) === "good" ? "low" : "medium",
        category: metric === "ttfb" ? "ttfb" : metric,
        metric: `${THRESHOLDS[metric].label} p75 trend (phone, field)`,
        currentValue: fmt(metric, latest),
        targetValue: `≤ ${fmt(metric, THRESHOLDS[metric].good)}`,
        evidence: `CrUX history (phone): ${fmt(metric, past)} on ${history.periods?.[history.periods.length - 9] || "~8 weeks ago"} → ${fmt(metric, latest)} on ${history.periods?.[history.periods.length - 1] || "latest window"}.`,
        rootCause: "A change shipped in this window degraded the metric. Correlate the inflection week with the deploy log.",
        userImpact: "Real users are measurably slower than they were two months ago.",
        businessImpact: "Unnoticed drift is how a passing Core Web Vital quietly becomes a failing one.",
        recommendation: "Bisect deploys around the inflection week and add the metric to a per-deploy regression gate (scripts/compare.mjs).",
        expectedImprovement: "Restoring the earlier value returns the metric to its previous band.",
        effort: "medium",
        frequency: 4,
        exposure: 4,
        confidence: 0.7,
        source: "crux",
      }),
    );
  }
  return out;
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

function pct(n) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

function isoDate(d) {
  if (!d) return "unknown";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

function truncate(s, max) {
  const clean = String(s).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
