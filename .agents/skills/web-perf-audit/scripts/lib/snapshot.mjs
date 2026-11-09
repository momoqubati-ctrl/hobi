// Builds the machine-readable snapshot the budget and regression gates consume.
// One snapshot per run: field p75 per route/device, lab metrics and byte weights,
// the score, and the deployment it belongs to.

import { fieldFor, labFor, auditItems } from "./measure.mjs";
import { performanceScore, countBySeverity } from "./findings.mjs";

const DEVICES = ["mobile", "desktop"];
const FONT_RE = /\.(woff2?|ttf|otf|eot)(\?|$)/i;

export function buildSnapshot({ ctx, meta, findings }) {
  const field = {};
  const lab = {};

  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const f = fieldFor(ctx, route, device);
      if (f) {
        field[route] = field[route] || {};
        field[route][device] = {
          lcp: f.metrics?.lcp?.p75 ?? null,
          inp: f.metrics?.inp?.p75 ?? null,
          cls: f.metrics?.cls?.p75 ?? null,
          fcp: f.metrics?.fcp?.p75 ?? null,
          ttfb: f.metrics?.ttfb?.p75 ?? null,
          source: f.source,
          scope: f.scope,
        };
      }

      const lh = labFor(ctx, route, device);
      if (lh) {
        const summary = auditItems(lh, "resource-summary");
        const byType = (type) => Number(summary.find((s) => s.resourceType === type)?.transferSize) || null;
        const fonts = auditItems(lh, "network-requests").filter((r) => FONT_RE.test(String(r.url || "")));
        const tp = lh.audits?.["third-party-summary"]?.items || [];
        lab[route] = lab[route] || {};
        lab[route][device] = {
          lcp: lh.metrics?.lcp ?? null,
          fcp: lh.metrics?.fcp ?? null,
          cls: lh.metrics?.cls ?? null,
          tbt: lh.metrics?.tbt ?? null,
          ttfb: lh.metrics?.ttfb ?? null,
          performanceScore: lh.performanceScore ?? null,
          scriptBytes: byType("script"),
          imageBytes: byType("image"),
          fontBytes: fonts.length ? fonts.reduce((n, f) => n + (Number(f.transferSize) || 0), 0) : byType("font"),
          totalBytes: byType("total") ?? (lh.audits?.["total-byte-weight"]?.numericValue ?? null),
          thirdPartyBlockingMs: tp.length ? Math.round(tp.reduce((n, i) => n + (Number(i.blockingTime) || 0), 0)) : null,
        };
      }
    }
  }

  return {
    generated: meta.date,
    target: meta.target,
    deploy: meta.deploy || null,
    mode: meta.mode,
    score: performanceScore(findings),
    findingCounts: countBySeverity(findings),
    metrics: { field, lab },
  };
}
