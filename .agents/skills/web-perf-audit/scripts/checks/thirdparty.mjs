// Third-party scripts: bytes, main-thread cost and blocking time, per entity.
//
// This module never recommends removing a business integration. It reports what
// each one costs and proposes a cheaper loading strategy — the keep/drop call
// belongs to whoever owns the integration.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";
import { labFor, audit } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];

export function run(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (!lighthouse) continue;
      const exposure = device === "mobile" ? 4 : 2;

      const summary = audit(lighthouse, "third-party-summary");
      const items = summary?.items || [];
      if (!items.length) continue;

      const totalBytes = items.reduce((n, i) => n + (Number(i.transferSize) || 0), 0);
      const totalBlocking = items.reduce((n, i) => n + (Number(i.blockingTime) || 0), 0);
      const totalMainThread = items.reduce((n, i) => n + (Number(i.mainThreadTime) || 0), 0);
      const budgetMs = ctx.budgets?.thirdParty?.blockingMs ?? 150;

      if (totalBlocking > budgetMs) {
        out.push(
          finding({
            id: "TP-BLOCKING-TIME",
            title: `Third-party scripts block the main thread for ${Math.round(totalBlocking)}ms on \`${route}\` (${device})`,
            severity: totalBlocking > 600 ? "high" : "medium",
            category: "thirdparty",
            scope: "page",
            route,
            devices: device,
            metric: "Lighthouse third-party-summary blockingTime",
            currentValue: `${Math.round(totalBlocking)}ms blocking · ${fmtBytes(totalBytes)} · ${Math.round(totalMainThread)}ms main thread`,
            targetValue: `≤ ${budgetMs}ms blocking`,
            evidence: entityTable(items),
            rootCause: "Third-party scripts execute on the main thread during load, competing with hydration and first input.",
            userImpact: "Interactions are ignored while vendor code runs — a leading cause of a failing INP.",
            businessImpact: "These scripts usually exist for measurement or support; they should not cost the experience they measure.",
            recommendation:
              "Keep the integrations, change how they load: defer non-essential tags until after interaction or idle, use a facade for heavy embeds, and move tag execution behind consent where applicable. Re-measure each one's cost before and after.",
            expectedImprovement: `Up to ${Math.round(totalBlocking)}ms of blocking time removed from the load phase.`,
            effort: "medium",
            fixSnippet: `// Next.js: load analytics after the page is interactive
import Script from 'next/script';
<Script src="https://vendor.example.com/tag.js" strategy="lazyOnload" />

// Heavy embeds: render a facade, load the real widget on click
<button onClick={() => setLoaded(true)}>Load chat</button>`,
            fixLang: "jsx",
            frequency: 4,
            exposure,
            confidence: 0.85,
            source: "psi-lab",
          }),
        );
      }

      const heaviest = [...items].sort((a, b) => (Number(b.blockingTime) || 0) - (Number(a.blockingTime) || 0))[0];
      if (heaviest && (Number(heaviest.blockingTime) || 0) > 250) {
        out.push(
          finding({
            id: "TP-DOMINANT-ENTITY",
            title: `${entityName(heaviest)} alone blocks ${Math.round(Number(heaviest.blockingTime))}ms on \`${route}\` (${device})`,
            severity: "medium",
            category: "thirdparty",
            scope: "page",
            route,
            devices: device,
            metric: "blocking time attributed to one third-party entity",
            currentValue: `${Math.round(Number(heaviest.blockingTime))}ms · ${fmtBytes(Number(heaviest.transferSize) || 0)}`,
            targetValue: "no single vendor above 100ms blocking",
            evidence: `${entityName(heaviest)} — ${fmtBytes(Number(heaviest.transferSize) || 0)} transferred, ${Math.round(Number(heaviest.mainThreadTime) || 0)}ms main-thread, ${Math.round(Number(heaviest.blockingTime) || 0)}ms blocking (${device}).`,
            rootCause: "One vendor dominates third-party cost on this route.",
            userImpact: "A single integration is responsible for most of the vendor-caused unresponsiveness.",
            businessImpact: "Gives the integration owner a specific number to weigh against its value.",
            recommendation: `Take the cost figure to whoever owns ${entityName(heaviest)}: defer it, replace it with a lighter server-side integration, or accept the cost explicitly.`,
            expectedImprovement: `Up to ${Math.round(Number(heaviest.blockingTime))}ms of blocking time.`,
            effort: "medium",
            frequency: 4,
            exposure,
            confidence: 0.9,
            source: "psi-lab",
          }),
        );
      }

      const facades = audit(lighthouse, "third-party-facades");
      if (facades && facades.score === 0 && facades.items?.length) {
        out.push(
          finding({
            id: "TP-FACADE-AVAILABLE",
            title: `Heavy embed(s) could load behind a facade on \`${route}\` (${device})`,
            severity: "low",
            category: "thirdparty",
            scope: "page",
            route,
            devices: device,
            metric: "Lighthouse third-party-facades",
            currentValue: `${facades.items.length} embed(s) loaded eagerly`,
            targetValue: "loaded on interaction",
            evidence: facades.items.slice(0, 5).map((i, n) => `${n + 1}. ${entityName(i)}`).join("\n"),
            rootCause: "Video, chat and map embeds pull large bundles during load even when the visitor never interacts with them.",
            userImpact: "Load-time cost for a feature most visitors do not use on that visit.",
            businessImpact: "Facades keep the feature available with none of the load cost.",
            recommendation: "Render a lightweight placeholder and load the real embed on first interaction.",
            expectedImprovement: "The embed's full download and execution cost moves off the load path.",
            effort: "low",
            fixSnippet: `// e.g. lite-youtube-embed, or a click-to-load wrapper of your own
<lite-youtube videoid="…" playlabel="Play"></lite-youtube>`,
            fixLang: "html",
            frequency: 3,
            exposure,
            confidence: 0.85,
            source: "psi-lab",
          }),
        );
      }
    }
  }
  return dedupe(out);
}

function entityTable(items, max = 6) {
  return items
    .slice()
    .sort((a, b) => (Number(b.blockingTime) || 0) - (Number(a.blockingTime) || 0))
    .slice(0, max)
    .map((i) => `${entityName(i).padEnd(28).slice(0, 28)} ${fmtBytes(Number(i.transferSize) || 0).padStart(9)}  main ${String(Math.round(Number(i.mainThreadTime) || 0)).padStart(5)}ms  blocking ${String(Math.round(Number(i.blockingTime) || 0)).padStart(5)}ms`)
    .join("\n");
}

function entityName(item) {
  const e = item?.entity;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") return String(e.text || e.name || e.url || "third party");
  return String(item?.url || "third party");
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
