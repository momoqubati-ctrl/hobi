// Codebase-mode findings, derived from static.mjs.
//
// These are *causes*, not measurements: a static finding says "this pattern will
// cost you", never "this page was slow". Severity is capped accordingly and the
// source is always labelled `static`.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";

export function run(ctx) {
  const info = ctx.staticInfo;
  if (!info) return [];
  const out = [];

  // --- client-component spread --------------------------------------------
  if (info.framework === "Next.js" && info.useClient.length) {
    const ratio = info.files ? info.useClient.length / info.files : 0;
    if (info.useClient.length >= 10 || ratio > 0.4) {
      out.push(
        finding({
          id: "STATIC-USE-CLIENT-SPREAD",
          title: `${info.useClient.length} files are marked \`"use client"\``,
          severity: ratio > 0.6 ? "medium" : "low",
          category: "javascript",
          metric: 'files containing "use client" (static)',
          currentValue: `${info.useClient.length} of ${info.files} scanned files (${Math.round(ratio * 100)}%)`,
          targetValue: "client components only at interactive leaves",
          evidence: info.useClient
            .slice()
            .sort((a, b) => b.lines - a.lines)
            .slice(0, 8)
            .map((f, n) => `${n + 1}. ${f.file} (${f.lines} lines)`)
            .join("\n"),
          rootCause: 'Every `"use client"` module and everything it imports is shipped to the browser and hydrated. Marking a container client-side pulls its whole subtree along with it.',
          userImpact: "More JavaScript to download, parse and hydrate before the page responds to input.",
          businessImpact: "The main structural cause of large route bundles in App Router projects.",
          recommendation: 'Push `"use client"` down to the leaf that actually needs state, effects or handlers. Pass server-rendered content through as `children` instead of importing it into a client component.',
          expectedImprovement: "Route bundle shrinks by whatever the wrongly-client subtree contributed.",
          effort: "medium",
          fixSnippet: `// Server component keeps the tree on the server…
export default function Page({ product }) {
  return (
    <Interactive>            {/* 'use client' lives here only */}
      <ProductDetails product={product} />   {/* stays server-rendered */}
    </Interactive>
  );
}`,
          fixLang: "jsx",
          frequency: 4,
          exposure: 4,
          confidence: 0.6,
          source: "static",
        }),
      );
    }
  }

  // --- unsized images ------------------------------------------------------
  if (info.unsizedImages.length) {
    out.push(
      finding({
        id: "STATIC-IMG-UNSIZED",
        title: `${info.unsizedImages.length} \`<img>\` tag(s) without width/height in source`,
        severity: info.unsizedImages.length > 10 ? "medium" : "low",
        category: "cls",
        metric: "<img> tags lacking dimensions (static)",
        currentValue: `${info.unsizedImages.length} tag(s)`,
        targetValue: "every <img> carries width/height or aspect-ratio",
        evidence: info.unsizedImages.slice(0, 8).map((i, n) => `${n + 1}. ${i.file}: ${i.snippet}`).join("\n"),
        rootCause: "Without intrinsic dimensions the browser reserves no space, so layout shifts when the image decodes.",
        userImpact: "Content jumps during load.",
        businessImpact: "A direct contributor to CLS on every page that renders these components.",
        recommendation: "Add width and height (or an aspect-ratio rule) to each tag, or switch to the framework image component.",
        expectedImprovement: "Removes these elements as layout-shift sources.",
        effort: "low",
        fixSnippet: `<img src={src} alt={alt} width={800} height={600} loading="lazy" decoding="async" />`,
        fixLang: "jsx",
        frequency: 3,
        exposure: 4,
        confidence: 0.8,
        source: "static",
      }),
    );
  }

  // --- externally hosted fonts --------------------------------------------
  if (info.externalFonts.length) {
    out.push(
      finding({
        id: "STATIC-FONT-EXTERNAL",
        title: `Fonts loaded from a third-party host in ${count(info.externalFonts, "file")} file(s)`,
        severity: "low",
        category: "fonts",
        metric: "external font stylesheet/file references (static)",
        currentValue: `${info.externalFonts.length} reference(s)`,
        targetValue: "self-hosted fonts on the document origin",
        evidence: info.externalFonts.slice(0, 6).map((f, n) => `${n + 1}. ${f.file}: ${f.url}`).join("\n"),
        rootCause: "A cross-origin font stylesheet adds a connection setup and an extra request level before the font can even be requested.",
        userImpact: "Text paints later, and on a slow connection the delay is compounded by the CSS→font request chain.",
        businessImpact: "Also removes a third-party runtime dependency from the critical path.",
        recommendation: "Self-host the font files, or use the framework font loader which inlines and self-hosts them at build time.",
        expectedImprovement: "One connection setup and one chain level removed from the font path.",
        effort: "low",
        fixSnippet: `import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], display: 'swap' });
export default function RootLayout({ children }) {
  return <html className={inter.className}>{children}</html>;
}`,
        fixLang: "jsx",
        frequency: 4,
        exposure: 4,
        confidence: 0.85,
        source: "static",
      }),
    );
  }

  // --- unmanaged third-party script tags -----------------------------------
  if (info.rawScriptTags.length) {
    out.push(
      finding({
        id: "STATIC-SCRIPT-BLOCKING",
        title: `${info.rawScriptTags.length} third-party \`<script>\` tag(s) without defer/async`,
        severity: "medium",
        category: "thirdparty",
        metric: "synchronous cross-origin script tags (static)",
        currentValue: `${info.rawScriptTags.length} tag(s)`,
        targetValue: "no synchronous third-party script in the document",
        evidence: info.rawScriptTags.slice(0, 6).map((s, n) => `${n + 1}. ${s.file}: ${s.snippet}`).join("\n"),
        rootCause: "A synchronous script blocks HTML parsing until it is fetched and executed — and it is fetched from someone else's server.",
        userImpact: "Rendering stops on a network round trip you do not control.",
        businessImpact: "A vendor outage or slowdown becomes your outage.",
        recommendation: "Load third-party tags through the framework script component with an explicit strategy, or at minimum add defer.",
        expectedImprovement: "Removes third-party latency from the parse-blocking path.",
        effort: "low",
        fixSnippet: `import Script from 'next/script';
<Script src="https://vendor.example.com/tag.js" strategy="afterInteractive" />`,
        fixLang: "jsx",
        frequency: 4,
        exposure: 4,
        confidence: 0.85,
        source: "static",
      }),
    );
  }

  // --- client-side data fetching ------------------------------------------
  if (info.clientDataFetching.length) {
    out.push(
      finding({
        id: "STATIC-CLIENT-DATA-FETCH",
        title: `${info.clientDataFetching.length} component(s) fetch data in \`useEffect\``,
        severity: "medium",
        category: "lcp",
        metric: "useEffect + fetch pairs (static)",
        currentValue: `${info.clientDataFetching.length} component(s)`,
        targetValue: "data fetched during the server render",
        evidence: info.clientDataFetching.slice(0, 8).map((c, n) => `${n + 1}. ${c.file}`).join("\n"),
        rootCause: "Fetching after mount serializes the work: HTML → JS download → hydrate → fetch → render. The content cannot exist in the initial paint.",
        userImpact: "Users see a skeleton where the content should be, and LCP waits for a round trip that started late.",
        businessImpact: "The content is also absent from the server-rendered HTML that crawlers and AI assistants read.",
        recommendation: "Fetch on the server (server component, loader, or getServerSideProps) so the content is in the first response. Keep client fetching for genuinely user-triggered data.",
        expectedImprovement: "Removes a full client round trip from the LCP path.",
        effort: "medium",
        fixSnippet: `// Server component — data is in the first HTML response
export default async function Page() {
  const products = await getProducts();
  return <ProductList products={products} />;
}`,
        fixLang: "jsx",
        frequency: 3,
        exposure: 4,
        confidence: 0.6,
        source: "static",
      }),
    );
  }

  // --- heavy dependencies --------------------------------------------------
  if (info.heavyDeps.length) {
    out.push(
      finding({
        id: "STATIC-HEAVY-DEPENDENCY",
        title: `${info.heavyDeps.length} dependency(ies) known for bundle weight`,
        severity: "low",
        category: "javascript",
        metric: "declared dependencies (static)",
        currentValue: info.heavyDeps.map((d) => `${d.dep}@${d.version}`).join(", "),
        targetValue: "no whole-library imports in client bundles",
        evidence: info.heavyDeps.map((d, n) => `${n + 1}. ${d.dep}@${d.version} — ${d.advice}`).join("\n"),
        rootCause: "These packages are commonly imported whole, pulling far more code than the few functions actually used.",
        userImpact: "Bundle weight with no visible feature attached to it.",
        businessImpact: "Usually replaceable without touching product behaviour.",
        recommendation: "Confirm with a bundle analysis whether each one actually reaches the client, then replace or scope the import.",
        expectedImprovement: "Varies — verify against the analyzer output rather than assuming.",
        effort: "medium",
        fixSnippet: `ANALYZE=true npx next build     # confirm what actually ships before removing anything`,
        fixLang: "bash",
        frequency: 3,
        exposure: 3,
        confidence: 0.5,
        source: "static",
      }),
    );
  }

  // --- built chunk sizes ---------------------------------------------------
  if (info.chunks?.largest?.length) {
    const budgetKb = ctx.budgets?.javascript?.routeKb ?? 300;
    const biggest = info.chunks.largest[0];
    if (biggest.bytes > budgetKb * 3 * 1024) {
      out.push(
        finding({
          id: "STATIC-LARGE-CHUNK",
          title: `Largest built chunk is ${fmtBytes(biggest.bytes)} uncompressed`,
          severity: "low",
          category: "javascript",
          metric: ".next/static/chunks file sizes (static)",
          currentValue: `${fmtBytes(biggest.bytes)} — ${info.chunks.count} chunks, ${fmtBytes(info.chunks.totalBytes)} total`,
          targetValue: `route bundles ≤ ${budgetKb} KB gzip`,
          evidence: `${info.chunks.largest.slice(0, 6).map((c, n) => `${n + 1}. ${c.file} — ${fmtBytes(c.bytes)}`).join("\n")}\n\n${info.chunks.note}`,
          rootCause: "One chunk concentrates a large amount of code, so any route that needs any part of it downloads all of it.",
          userImpact: "Download and parse cost concentrated in a single blocking asset.",
          businessImpact: "Large shared chunks slow every route, not just the one that needed the code.",
          recommendation: "Inspect the chunk with the bundle analyzer and split what only some routes need.",
          expectedImprovement: "Verify against the analyzer; only the moved code is saved.",
          effort: "medium",
          frequency: 4,
          exposure: 4,
          confidence: 0.6,
          source: "static",
        }),
      );
    }
  }

  // --- RUM instrumentation -------------------------------------------------
  if (!info.rum.length) {
    out.push(
      finding({
        id: "STATIC-NO-RUM",
        title: "No first-party RUM instrumentation found in the codebase",
        severity: "medium",
        category: "rum",
        metric: "web-vitals / RUM provider imports (static)",
        currentValue: "none detected",
        targetValue: "LCP, INP, CLS, FCP, TTFB reported with attribution and route/device dimensions",
        evidence: `Scanned ${info.files} source file(s) for web-vitals, useReportWebVitals, Speed Insights, Sentry, Datadog RUM, New Relic and GA4 signals; none matched.`,
        rootCause: "Without field instrumentation the only production signal is CrUX, which is Chrome-only, p75-only, 28-day-lagged and unavailable for low-traffic or authenticated routes.",
        userImpact: "Regressions that affect real users can ship and stay unnoticed for weeks.",
        businessImpact: "No way to tie a deploy to a change in real-user performance, and no percentile beyond p75.",
        recommendation: "Add a small web-vitals beacon with the attribution build and the dimensions listed in references/RUM_IMPLEMENTATION.md. assets/rum-collector.js is a working starting point — it is not installed by this skill.",
        expectedImprovement: "Per-route, per-device p75/p95 within days, and per-deploy comparison.",
        effort: "medium",
        fixSnippet: `import { onLCP, onINP, onCLS, onTTFB, onFCP } from 'web-vitals/attribution';
const send = (m) => navigator.sendBeacon('/api/vitals', JSON.stringify(m));
[onLCP, onINP, onCLS, onTTFB, onFCP].forEach((on) => on(send));`,
        fixLang: "js",
        frequency: 4,
        exposure: 4,
        confidence: 0.9,
        source: "static",
      }),
    );
  } else {
    out.push(
      finding({
        id: "STATIC-RUM-PRESENT",
        title: `RUM instrumentation detected: ${info.rum.join(", ")}`,
        severity: "info",
        category: "rum",
        status: "info",
        metric: "RUM provider signals (static)",
        currentValue: info.rum.join(", "),
        targetValue: "attribution + route/device/deploy dimensions",
        evidence: `Detected in source: ${info.rum.join(", ")}.`,
        recommendation:
          "Confirm it reports the attribution fields (LCP subparts, INP phases, CLS sources) and the dimensions needed for segmentation — route, device, connection, deployment ID. Collecting only the metric value cannot explain a regression.",
        source: "static",
      }),
    );
  }

  return out;
}

function count(items, key) {
  return new Set(items.map((i) => i[key])).size;
}
