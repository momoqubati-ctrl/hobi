// Fonts: blocking behaviour, font-display, preloading, and how many faces the
// page actually downloads.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";
import { labFor, audit, auditItems } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];
const FONT_RE = /\.(woff2?|ttf|otf|eot)(\?|$)/i;

export function run(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (!lighthouse) continue;
      const exposure = device === "mobile" ? 4 : 2;

      const display = audit(lighthouse, "font-display");
      if (display && display.score === 0) {
        out.push(
          finding({
            id: "FONT-DISPLAY-BLOCKING",
            title: `Web fonts block text rendering on \`${route}\` (${device})`,
            severity: "medium",
            category: "lcp",
            scope: "page",
            route,
            devices: device,
            metric: "Lighthouse font-display",
            currentValue: display.displayValue || "font-display not set to swap/optional",
            targetValue: "font-display: swap (or optional)",
            evidence: list(display.items, (i) => `${shortUrl(i.url)}${i.wastedMs ? ` — ${Math.round(Number(i.wastedMs))}ms blocked` : ""}`),
            rootCause: "The default `font-display: auto` gives the font a block period, so text stays invisible while the file downloads.",
            userImpact: "Invisible text during load; if the LCP element is text, LCP waits for the font.",
            businessImpact: "A one-line CSS change that can move LCP directly.",
            recommendation: "Use `font-display: swap` for brand text, `optional` where a fallback is acceptable, and self-host the file.",
            expectedImprovement: "Text paints on the first frame instead of after the font download.",
            effort: "low",
            fixSnippet: `@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter.woff2') format('woff2');
  font-display: swap;   /* or: optional */
  font-weight: 100 900; /* one variable file instead of many statics */
}

/* Next.js does this for you: */
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], display: 'swap' });`,
            fixLang: "css",
            frequency: 4,
            exposure,
            confidence: 0.9,
            source: "psi-lab",
          }),
        );
      }

      const fonts = auditItems(lighthouse, "network-requests").filter((r) => FONT_RE.test(String(r.url || "")));
      const totalBytes = fonts.reduce((n, f) => n + (Number(f.transferSize) || 0), 0);
      const budgetKb = ctx.budgets?.fonts?.totalKb ?? 150;

      if (fonts.length > 4 || totalBytes > budgetKb * 1024) {
        out.push(
          finding({
            id: "FONT-TOO-MANY-FACES",
            title: `${fonts.length} font file(s), ${fmtBytes(totalBytes)} on \`${route}\` (${device})`,
            severity: totalBytes > budgetKb * 2 * 1024 ? "medium" : "low",
            category: "fonts",
            scope: "page",
            route,
            devices: device,
            metric: "font requests and transfer size (lab waterfall)",
            currentValue: `${fonts.length} files · ${fmtBytes(totalBytes)}`,
            targetValue: `≤ 4 files · ≤ ${budgetKb} KB`,
            evidence: list(fonts, (f) => `${shortUrl(f.url)} — ${fmtBytes(Number(f.transferSize) || 0)}`),
            rootCause: "Every weight, style and script subset is a separate download; static families multiply quickly.",
            userImpact: "Font bytes compete with the LCP image for bandwidth on the critical path.",
            businessImpact: "Rarely noticed and easy to cut without design change.",
            recommendation: "Move to one variable font per family, subset to the scripts you ship, and drop unused weights.",
            expectedImprovement: `Typically 50–70% of ${fmtBytes(totalBytes)}.`,
            effort: "medium",
            fixSnippet: `import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], display: 'swap', axes: ['opsz'] });`,
            fixLang: "jsx",
            frequency: 4,
            exposure,
            confidence: 0.8,
            source: "psi-lab",
          }),
        );
      }

      const thirdPartyFonts = fonts.filter((f) => isThirdParty(f.url, ctx.target));
      if (thirdPartyFonts.length) {
        out.push(
          finding({
            id: "FONT-THIRD-PARTY-HOSTED",
            title: `Fonts loaded from a third-party origin on \`${route}\` (${device})`,
            severity: "low",
            category: "fonts",
            scope: "page",
            route,
            devices: device,
            metric: "font request origins",
            currentValue: `${thirdPartyFonts.length} cross-origin font file(s)`,
            targetValue: "self-hosted, same-origin fonts",
            evidence: list(thirdPartyFonts, (f) => shortUrl(f.url)),
            rootCause: "Cross-origin fonts add DNS + TCP + TLS before the download starts, and cannot reuse the document connection.",
            userImpact: "Text paints later than it needs to, especially on high-latency mobile networks.",
            businessImpact: "Also removes a third-party dependency from the critical path.",
            recommendation: "Self-host the font files (next/font does this automatically) and preload the one used above the fold.",
            expectedImprovement: "Removes one connection setup (~100–300ms on mobile) from the font path.",
            effort: "low",
            fixSnippet: `<link rel="preload" as="font" type="font/woff2" href="/fonts/inter-var.woff2" crossorigin>`,
            fixLang: "html",
            frequency: 4,
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

function isThirdParty(url, target) {
  try {
    return new URL(String(url)).origin !== new URL(target).origin;
  } catch {
    return false;
  }
}

function list(items, format, max = 5) {
  if (!Array.isArray(items) || !items.length) return "No per-resource detail returned by the lab run.";
  return items.slice(0, max).map((i, n) => `${n + 1}. ${format(i)}`).join("\n");
}

function shortUrl(u) {
  if (!u) return "(unknown)";
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
