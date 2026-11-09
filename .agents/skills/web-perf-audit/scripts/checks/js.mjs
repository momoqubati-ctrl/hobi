// JavaScript weight and execution: transferred, unused, duplicated, legacy, and
// the main-thread cost of running it. All values come from the lab run — labelled
// as lab, never presented as field truth.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";
import { labFor, audit, auditItems, sumBy } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];

export function run(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (!lighthouse) continue;
      out.push(...forRun(ctx, route, device, lighthouse));
    }
  }
  return dedupe(out);
}

function forRun(ctx, route, device, lighthouse) {
  const out = [];
  const budgetKb = ctx.budgets?.javascript?.routeKb ?? 300;
  const exposure = device === "mobile" ? 4 : 2;

  // --- total script weight -------------------------------------------------
  const summary = auditItems(lighthouse, "resource-summary");
  const script = summary.find((i) => i.resourceType === "script");
  if (script && Number(script.transferSize) > budgetKb * 1024) {
    const kb = Math.round(Number(script.transferSize) / 1024);
    out.push(
      finding({
        id: "JS-ROUTE-WEIGHT",
        title: `\`${route}\` ships ${kb} KB of JavaScript (${device})`,
        severity: kb > budgetKb * 2 ? "high" : "medium",
        category: "javascript",
        scope: "page",
        route,
        devices: device,
        metric: "transferred script bytes (lab)",
        currentValue: `${kb} KB over ${script.requestCount ?? "?"} requests`,
        targetValue: `≤ ${budgetKb} KB`,
        evidence: `Lighthouse resource summary (${device}): script transfer ${fmtBytes(Number(script.transferSize))} across ${script.requestCount ?? "?"} requests. Budget: ${budgetKb} KB.`,
        rootCause: "The route's bundle exceeds its budget — usually a heavy dependency pulled into the initial chunk, or a component tree that could load on demand.",
        userImpact: "Every byte must be downloaded, parsed, compiled and executed before the page becomes interactive — a mid-range phone pays several times what a laptop pays.",
        businessImpact: "Bundle weight is the most reliable predictor of poor INP and slow interactive time on mobile.",
        recommendation: "Attribute the bundle per route, then code-split the biggest contributors behind dynamic imports and move server-only work out of client components.",
        expectedImprovement: `Each 100 KB removed cuts roughly 100–200ms of parse+execute on a mid-range phone.`,
        effort: "medium",
        fixSnippet: `# Find what is actually in the route bundle
ANALYZE=true npx next build          # with @next/bundle-analyzer wired up
npx source-map-explorer '.next/static/chunks/*.js'

# Then split the heavy, rarely-used parts
const Chart = dynamic(() => import('./Chart'), { ssr: false, loading: () => <Skeleton /> });`,
        fixLang: "bash",
        frequency: 4,
        exposure,
        confidence: 0.9,
        source: "psi-lab",
      }),
    );
  }

  // --- unused JavaScript ---------------------------------------------------
  const unused = audit(lighthouse, "unused-javascript");
  const unusedBytes = unused?.overallSavingsBytes ?? sumBy(unused?.items || [], "wastedBytes");
  if (unusedBytes > 50 * 1024) {
    out.push(
      finding({
        id: "JS-UNUSED",
        title: `${fmtBytes(unusedBytes)} of unused JavaScript on \`${route}\` (${device})`,
        severity: unusedBytes > 250 * 1024 ? "high" : "medium",
        category: "javascript",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse unused-javascript",
        currentValue: fmtBytes(unusedBytes),
        targetValue: "< 50 KB unused on first load",
        evidence: topItems(unused?.items, (i) => `${fmtBytes(Number(i.wastedBytes) || 0)} unused of ${fmtBytes(Number(i.totalBytes) || 0)} — ${shortUrl(i.url)}`),
        rootCause: "Code for routes, variants or features the visitor never reaches is bundled into the first load.",
        userImpact: "Users download and compile code that never runs.",
        businessImpact: "Pure waste: removing it costs nothing in functionality.",
        recommendation: "Dynamic-import the listed modules at their use site, and import symbols individually instead of whole barrel files.",
        expectedImprovement: `Up to ${fmtBytes(unusedBytes)} off the initial download and its parse cost.`,
        effort: "medium",
        fixSnippet: `// next.config.js — tree-shake big barrel packages
module.exports = { experimental: { optimizePackageImports: ['lodash-es', 'date-fns', '@mui/icons-material'] } };

// and import only what you use
import debounce from 'lodash-es/debounce';   // not: import { debounce } from 'lodash-es'`,
        fixLang: "js",
        frequency: 4,
        exposure,
        confidence: 0.85,
        source: "psi-lab",
      }),
    );
  }

  // --- duplicated modules --------------------------------------------------
  const dupes = audit(lighthouse, "duplicated-javascript");
  const dupeBytes = dupes?.overallSavingsBytes ?? sumBy(dupes?.items || [], "wastedBytes");
  if (dupeBytes > 10 * 1024) {
    out.push(
      finding({
        id: "JS-DUPLICATED",
        title: `${fmtBytes(dupeBytes)} of duplicated modules on \`${route}\` (${device})`,
        severity: "medium",
        category: "javascript",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse duplicated-javascript",
        currentValue: fmtBytes(dupeBytes),
        targetValue: "one copy per module",
        evidence: topItems(dupes?.items, (i) => `${shortUrl(i.source || i.url)} — ${fmtBytes(Number(i.wastedBytes) || 0)} duplicated`),
        rootCause: "Two versions of the same package resolved in the dependency tree, or the same module landed in multiple chunks.",
        userImpact: "The same code is downloaded and executed more than once.",
        businessImpact: "Silent bundle inflation that grows with every dependency bump.",
        recommendation: "De-duplicate the dependency tree and pin one version.",
        expectedImprovement: `${fmtBytes(dupeBytes)} removed from the route bundle.`,
        effort: "low",
        fixSnippet: `npm ls <package>            # find the conflicting versions
npm dedupe
# or pin one copy:
# package.json → "overrides": { "<package>": "^3.4.0" }`,
        fixLang: "bash",
        frequency: 4,
        exposure,
        confidence: 0.9,
        source: "psi-lab",
      }),
    );
  }

  // --- legacy transpilation ------------------------------------------------
  const legacy = audit(lighthouse, "legacy-javascript");
  const legacyBytes = legacy?.overallSavingsBytes ?? sumBy(legacy?.items || [], "wastedBytes");
  if (legacyBytes > 20 * 1024) {
    out.push(
      finding({
        id: "JS-LEGACY-POLYFILLS",
        title: `${fmtBytes(legacyBytes)} of legacy polyfills/transpilation on \`${route}\` (${device})`,
        severity: "low",
        category: "javascript",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse legacy-javascript",
        currentValue: fmtBytes(legacyBytes),
        targetValue: "no polyfills for baseline-supported features",
        evidence: topItems(legacy?.items, (i) => `${shortUrl(i.url)} — ${fmtBytes(Number(i.wastedBytes) || 0)}`),
        rootCause: "The build targets browsers older than the audience actually uses, so modern engines download polyfills they will never execute.",
        userImpact: "Extra bytes and extra parse time for every modern browser.",
        businessImpact: "A build-config change with no product risk.",
        recommendation: "Raise the browserslist target to match real traffic, and verify against the browser breakdown in RUM before changing it.",
        expectedImprovement: `${fmtBytes(legacyBytes)} off every page load.`,
        effort: "low",
        fixSnippet: `// package.json
"browserslist": [">0.3%", "last 2 versions", "not dead", "not op_mini all"]`,
        fixLang: "json",
        frequency: 4,
        exposure,
        confidence: 0.8,
        source: "psi-lab",
      }),
    );
  }

  // --- execution cost ------------------------------------------------------
  const bootup = audit(lighthouse, "bootup-time");
  if (bootup?.numericValue != null && bootup.numericValue > 2000) {
    const breakdown = auditItems(lighthouse, "mainthread-work-breakdown");
    out.push(
      finding({
        id: "JS-EXECUTION-TIME",
        title: `${Math.round(bootup.numericValue)}ms of script evaluation on \`${route}\` (${device})`,
        severity: bootup.numericValue > 4000 ? "high" : "medium",
        category: "javascript",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse bootup-time",
        currentValue: `${Math.round(bootup.numericValue)}ms`,
        targetValue: "< 2000ms on the mobile profile",
        evidence: [
          `Script evaluation + parse (${device}): ${Math.round(bootup.numericValue)}ms.`,
          topItems(bootup.items, (i) => `${Math.round(Number(i.total) || 0)}ms total (${Math.round(Number(i.scripting) || 0)}ms scripting) — ${shortUrl(i.url)}`),
          breakdown.length ? `Main-thread breakdown: ${breakdown.slice(0, 4).map((b) => `${b.groupLabel || b.group} ${Math.round(Number(b.duration) || 0)}ms`).join(", ")}.` : null,
        ].filter(Boolean).join("\n"),
        rootCause: "Too much JavaScript runs before the page is usable — typically hydration of components that did not need to be interactive.",
        userImpact: "The page looks ready but ignores taps while scripts evaluate.",
        businessImpact: "Execution cost, not download size, is what breaks INP on mid-range phones.",
        recommendation: "Cut client-side work: keep components server-rendered where possible, defer non-critical scripts, and split what remains.",
        expectedImprovement: "Halving script evaluation typically halves blocking time.",
        effort: "high",
        fixSnippet: `// Keep the component on the server unless it truly needs interactivity.
// Only the leaf that uses state/effects/handlers needs 'use client'.
export default function ProductPage({ product }) {   // server component
  return (<><ProductInfo product={product} /><AddToCart id={product.id} /></>);
}`,
        fixLang: "jsx",
        frequency: 4,
        exposure,
        confidence: 0.85,
        source: "psi-lab",
      }),
    );
  }

  // --- DOM size ------------------------------------------------------------
  const dom = audit(lighthouse, "dom-size");
  if (dom?.numericValue != null && dom.numericValue > 1400) {
    out.push(
      finding({
        id: "RUNTIME-DOM-SIZE",
        title: `${Math.round(dom.numericValue)} DOM elements on \`${route}\` (${device})`,
        severity: dom.numericValue > 3000 ? "medium" : "low",
        category: "runtime",
        scope: "page",
        route,
        devices: device,
        metric: "Lighthouse dom-size",
        currentValue: `${Math.round(dom.numericValue)} elements`,
        targetValue: "< 1400 elements",
        evidence: `DOM size (${device}): ${Math.round(dom.numericValue)} elements. ${dom.displayValue || ""}`.trim(),
        rootCause: "A large tree makes every style recalculation, layout and re-render more expensive, which shows up as INP rather than load time.",
        userImpact: "Scrolling and interaction get progressively slower on long pages.",
        businessImpact: "Compounds with every client-side re-render.",
        recommendation: "Virtualize long lists, paginate, and avoid rendering hidden content that could mount on demand.",
        expectedImprovement: "Lower style/layout cost per interaction, improving INP.",
        effort: "medium",
        fixSnippet: `// Render only what is on screen
import { useVirtualizer } from '@tanstack/react-virtual';`,
        fixLang: "jsx",
        frequency: 3,
        exposure,
        confidence: 0.7,
        source: "psi-lab",
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
