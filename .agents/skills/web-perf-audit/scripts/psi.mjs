#!/usr/bin/env node
// PageSpeed Insights v5 — lab measurements (Lighthouse) plus CrUX field data.
//
//   node psi.mjs --url https://example.com [--strategy mobile|desktop|both]
//                [--routes /a,/b] [--psi-key KEY] [--out lab.json]
//
// PSI is the workhorse: one call returns a full Lighthouse run (the audits the
// check engine mines for JS, network, image, font and third-party findings) AND
// `loadingExperience` / `originLoadingExperience`, which are CrUX field data —
// so field numbers are available even without a CrUX API key.
//
// A key is optional at low volume; supply --psi-key (or PSI_API_KEY) for quota.

import { writeFile } from "node:fs/promises";
import { parseArgs, list } from "./lib/args.mjs";
import { getJson } from "./lib/fetch.mjs";

const API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Lighthouse audits the check engine reads. Anything not listed is dropped from lab.json. */
export const KEPT_AUDITS = [
  "render-blocking-resources",
  "unused-javascript",
  "unused-css-rules",
  "duplicated-javascript",
  "legacy-javascript",
  "bootup-time",
  "mainthread-work-breakdown",
  "long-tasks",
  "third-party-summary",
  "third-party-facades",
  "network-requests",
  "network-server-latency",
  "server-response-time",
  "critical-request-chains",
  "uses-long-cache-ttl",
  "uses-text-compression",
  "redirects",
  "uses-rel-preconnect",
  "uses-rel-preload",
  "font-display",
  "modern-image-formats",
  "uses-responsive-images",
  "uses-optimized-images",
  "efficient-animated-content",
  "prioritize-lcp-image",
  "lcp-lazy-loaded",
  "unsized-images",
  "largest-contentful-paint-element",
  "layout-shift-elements",
  "non-composited-animations",
  "dom-size",
  "total-byte-weight",
  "resource-summary",
  "viewport",
];

/** PSI `loadingExperience` metric name → the short key used everywhere else. */
const FIELD_MAP = {
  LARGEST_CONTENTFUL_PAINT_MS: "lcp",
  INTERACTION_TO_NEXT_PAINT: "inp",
  CUMULATIVE_LAYOUT_SHIFT_SCORE: "cls",
  FIRST_CONTENTFUL_PAINT_MS: "fcp",
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: "ttfb",
};

/**
 * Normalize `loadingExperience` into { lcp: { p75, distribution, category }, … }.
 * PSI reports CLS as an integer hundredth (10 → 0.10); it is scaled back here.
 */
export function normalizeFieldExperience(exp) {
  if (!exp?.metrics) return null;
  const metrics = {};
  for (const [psiName, short] of Object.entries(FIELD_MAP)) {
    const m = exp.metrics[psiName];
    if (!m) continue;
    const scale = short === "cls" ? 0.01 : 1;
    const dists = m.distributions || [];
    metrics[short] = {
      p75: m.percentile == null ? null : round(m.percentile * scale),
      p50: null, // PSI exposes p75 only
      p90: null,
      p95: null,
      p99: null,
      approximate: { p50: false, p90: false },
      distribution: dists.length >= 3
        ? { good: dists[0].proportion, needsImprovement: dists[1].proportion, poor: dists[2].proportion }
        : null,
      category: m.category || null,
    };
  }
  return {
    id: exp.id || null,
    overall: exp.overall_category || null,
    metrics,
  };
}

/** Normalize the Lighthouse half of a PSI response. */
export function normalizeLighthouse(lhr) {
  if (!lhr) return null;
  const audits = {};
  for (const id of KEPT_AUDITS) {
    const a = lhr.audits?.[id];
    if (!a) continue;
    audits[id] = {
      score: a.score ?? null,
      scoreDisplayMode: a.scoreDisplayMode || null,
      displayValue: a.displayValue || "",
      numericValue: a.numericValue ?? null,
      overallSavingsMs: a.details?.overallSavingsMs ?? null,
      overallSavingsBytes: a.details?.overallSavingsBytes ?? null,
      items: compactItems(a.details?.items),
    };
  }
  return {
    version: lhr.lighthouseVersion || null,
    fetchTime: lhr.fetchTime || null,
    finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl || null,
    performanceScore: lhr.categories?.performance?.score == null ? null : Math.round(lhr.categories.performance.score * 100),
    metrics: {
      lcp: num(lhr.audits?.["largest-contentful-paint"]?.numericValue),
      fcp: num(lhr.audits?.["first-contentful-paint"]?.numericValue),
      cls: num(lhr.audits?.["cumulative-layout-shift"]?.numericValue),
      tbt: num(lhr.audits?.["total-blocking-time"]?.numericValue),
      si: num(lhr.audits?.["speed-index"]?.numericValue),
      tti: num(lhr.audits?.interactive?.numericValue),
      ttfb: num(lhr.audits?.["server-response-time"]?.numericValue),
    },
    audits,
  };
}

/** Run PSI once. Returns a normalized run record; never throws. */
export async function runPsi({ url, strategy = "mobile", key = "" }) {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) params.set("key", key);
  const res = await getJson(`${API}?${params.toString()}`, { timeoutMs: 120000 });
  if (!res.ok || !res.json) {
    return { url, strategy, status: "error", error: res.error || `HTTP ${res.status}`, lighthouse: null, field: null, originField: null };
  }
  return {
    url,
    strategy,
    status: "ok",
    error: null,
    lighthouse: normalizeLighthouse(res.json.lighthouseResult),
    field: normalizeFieldExperience(res.json.loadingExperience),
    originField: normalizeFieldExperience(res.json.originLoadingExperience),
  };
}

/** Run PSI over a set of routes and strategies. */
export async function collectLab({ url, routes = [], strategies = ["mobile"], key = "" }) {
  const targets = routes.length ? routes.map((r) => new URL(r, url).toString()) : [url];
  const runs = [];
  for (const target of targets) {
    for (const strategy of strategies) {
      runs.push(await runPsi({ url: target, strategy, key }));
    }
  }
  return { source: "psi", generated: new Date().toISOString(), target: url, runs };
}

function compactItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 25).map((item) => {
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object") {
        // Lighthouse wraps values (e.g. {type:'url', value:…}); keep the useful leaves only.
        if (typeof v.value === "string" || typeof v.value === "number") out[k] = v.value;
        else if (typeof v.url === "string") out[k] = v.url;
        else if (typeof v.snippet === "string") out[k] = v.snippet;
        continue;
      }
      out[k] = v;
    }
    return out;
  });
}

function num(v) {
  return v == null || Number.isNaN(v) ? null : Math.round(Number(v));
}

function round(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url;
  if (!url || url === true) {
    console.error("Usage: psi.mjs --url https://example.com [--strategy mobile|desktop|both] [--routes /a,/b] [--psi-key KEY] [--out lab.json]");
    return 2;
  }
  const strategy = typeof args.strategy === "string" ? args.strategy : "mobile";
  const strategies = strategy === "both" ? ["mobile", "desktop"] : [strategy];
  const key = typeof args["psi-key"] === "string" ? args["psi-key"] : process.env.PSI_API_KEY || "";

  const data = await collectLab({ url, routes: list(args.routes), strategies, key });
  const failed = data.runs.filter((r) => r.status !== "ok");
  const json = JSON.stringify(data, null, 2);
  if (typeof args.out === "string") {
    await writeFile(args.out, json, "utf8");
    console.log(`Wrote ${args.out} — ${data.runs.length - failed.length}/${data.runs.length} PSI runs succeeded.`);
    for (const f of failed) console.error(`  ! ${f.strategy} ${f.url}: ${f.error}`);
  } else {
    console.log(json);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
