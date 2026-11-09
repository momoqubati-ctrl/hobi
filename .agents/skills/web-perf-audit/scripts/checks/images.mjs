// Images: dimensions, format, compression, responsive variants, and the ones
// that break CLS by arriving without reserved space.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";
import { labFor, audit } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];

const CHECKS = [
  {
    auditId: "uses-responsive-images",
    id: "IMG-OVERSIZED",
    category: "images",
    minBytes: 100 * 1024,
    title: (kb) => `${kb} of image bytes are larger than their rendered size`,
    severity: (b) => (b > 500 * 1024 ? "high" : "medium"),
    rootCause: "The same image file is served to every viewport, so phones download desktop-sized pixels and downscale them.",
    userImpact: "Mobile users pay for pixels that are thrown away before they are painted.",
    businessImpact: "Usually the single largest source of wasted bytes on a page.",
    recommendation: "Serve responsive variants with srcset/sizes so each device gets the resolution it renders.",
    fixLang: "jsx",
    fixSnippet: `<Image
  src={product.image}
  alt={product.name}
  width={800}
  height={800}
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
/>`,
    effort: "low",
  },
  {
    auditId: "modern-image-formats",
    id: "IMG-LEGACY-FORMAT",
    category: "images",
    minBytes: 50 * 1024,
    title: (kb) => `${kb} recoverable by serving AVIF/WebP instead of JPEG/PNG`,
    severity: (b) => (b > 300 * 1024 ? "medium" : "low"),
    rootCause: "Images are encoded in formats that predate AVIF and WebP, both of which are now baseline-supported.",
    userImpact: "Larger downloads for identical visual quality.",
    businessImpact: "A build/CDN configuration change, not a design change.",
    recommendation: "Let the image pipeline negotiate format per request, keeping the legacy file as fallback.",
    fixLang: "html",
    fixSnippet: `<picture>
  <source srcset="/hero.avif" type="image/avif">
  <source srcset="/hero.webp" type="image/webp">
  <img src="/hero.jpg" width="1200" height="630" alt="…">
</picture>`,
    effort: "low",
  },
  {
    auditId: "uses-optimized-images",
    id: "IMG-UNCOMPRESSED",
    category: "images",
    minBytes: 50 * 1024,
    title: (kb) => `${kb} recoverable by compressing images properly`,
    severity: () => "low",
    rootCause: "Images are exported at a higher quality setting than the delivery context needs.",
    userImpact: "Extra bytes with no perceptible quality gain.",
    businessImpact: "Pure download waste.",
    recommendation: "Compress at quality 75–82 for photographic content and re-encode at build or CDN time.",
    fixLang: "bash",
    fixSnippet: `npx @squoosh/cli --avif '{"cqLevel":33}' --webp '{"quality":80}' public/images/*.jpg`,
    effort: "low",
  },
  {
    auditId: "efficient-animated-content",
    id: "IMG-ANIMATED-GIF",
    category: "images",
    minBytes: 100 * 1024,
    title: (kb) => `${kb} recoverable by replacing animated GIFs with video`,
    severity: () => "medium",
    rootCause: "Animated GIFs encode video frames in an image container, typically 5–10× larger than an equivalent MP4/WebM.",
    userImpact: "Very large downloads and high decode cost for a short loop.",
    businessImpact: "Often the largest single asset on a marketing page.",
    recommendation: "Replace with a muted, looping, autoplaying video element.",
    fixLang: "html",
    fixSnippet: `<video autoplay loop muted playsinline width="640" height="360" poster="/loop.jpg">
  <source src="/loop.webm" type="video/webm">
  <source src="/loop.mp4" type="video/mp4">
</video>`,
    effort: "low",
  },
];

export function run(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    for (const device of DEVICES) {
      const lighthouse = labFor(ctx, route, device);
      if (!lighthouse) continue;
      const exposure = device === "mobile" ? 4 : 2;

      for (const spec of CHECKS) {
        const a = audit(lighthouse, spec.auditId);
        const savings = a?.overallSavingsBytes ?? 0;
        if (!a || savings < spec.minBytes) continue;
        out.push(
          finding({
            id: spec.id,
            title: `${spec.title(fmtBytes(savings))} on \`${route}\` (${device})`,
            severity: spec.severity(savings),
            category: spec.category,
            scope: "page",
            route,
            devices: device,
            metric: `Lighthouse ${spec.auditId}`,
            currentValue: fmtBytes(savings),
            targetValue: "no recoverable image bytes above 50 KB",
            evidence: itemList(a.items),
            rootCause: spec.rootCause,
            userImpact: spec.userImpact,
            businessImpact: spec.businessImpact,
            recommendation: spec.recommendation,
            expectedImprovement: `${fmtBytes(savings)} less to download on ${device}.`,
            effort: spec.effort,
            fixSnippet: spec.fixSnippet,
            fixLang: spec.fixLang,
            frequency: 4,
            exposure,
            confidence: 0.9,
            source: "psi-lab",
          }),
        );
      }

      const unsized = audit(lighthouse, "unsized-images");
      if (unsized && unsized.score === 0 && unsized.items?.length) {
        out.push(
          finding({
            id: "IMG-NO-DIMENSIONS",
            title: `${unsized.items.length} image(s) without width/height on \`${route}\` (${device})`,
            severity: "medium",
            category: "cls",
            scope: "page",
            route,
            devices: device,
            metric: "Lighthouse unsized-images",
            currentValue: `${unsized.items.length} image(s)`,
            targetValue: "every image has intrinsic dimensions or aspect-ratio",
            evidence: itemList(unsized.items),
            rootCause: "Without dimensions the browser cannot reserve space, so layout jumps when each image finally decodes.",
            userImpact: "Content shifts under the reader — the most common cause of a failing CLS.",
            businessImpact: "Directly drives CLS, a Core Web Vital.",
            recommendation: "Set explicit width and height (or aspect-ratio) on every image element.",
            expectedImprovement: "Usually removes the dominant layout-shift contributor.",
            effort: "low",
            fixSnippet: `<img src="/photo.jpg" width="800" height="600" alt="…">
<!-- or -->
img { aspect-ratio: 4 / 3; width: 100%; height: auto; }`,
            fixLang: "html",
            frequency: 4,
            exposure,
            confidence: 0.95,
            source: "psi-lab",
          }),
        );
      }
    }
  }
  return dedupe(out);
}

function itemList(items, max = 5) {
  if (!Array.isArray(items) || !items.length) return "No per-resource detail returned by the lab run.";
  return items
    .slice(0, max)
    .map((i, n) => {
      const url = shortUrl(i.url || i.node || i.snippet);
      const total = Number(i.totalBytes) || 0;
      const wasted = Number(i.wastedBytes) || 0;
      const size = total ? ` — ${fmtBytes(total)}${wasted ? ` (saves ${fmtBytes(wasted)})` : ""}` : "";
      return `${n + 1}. ${url}${size}`;
    })
    .join("\n");
}

function shortUrl(u) {
  if (!u) return "(unknown)";
  try {
    const { host, pathname } = new URL(String(u));
    return `${host}${pathname}`.slice(0, 120);
  } catch {
    return String(u).replace(/\s+/g, " ").slice(0, 120);
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
