#!/usr/bin/env node
// Deployment regression gate: compare two run.mjs snapshots.
//
//   node compare.mjs --baseline baseline.json --current current.json \
//                    [--tolerance 0.1] [--out REGRESSION.md] [--json] [--report-only]
//
// Exit 0 when nothing regressed beyond tolerance, 1 when something did, 2 on bad
// input. `--report-only` always exits 0 (useful for a warn-only pipeline stage).
//
// Field metrics move on a 28-day rolling window, so a same-day field comparison
// will usually show no change. That is a property of CrUX, not a passing deploy —
// the lab and byte-weight rows are what gate a deploy on the day it ships.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "./lib/args.mjs";

const FIELD_METRICS = [
  ["lcp", "LCP p75", "ms"],
  ["inp", "INP p75", "ms"],
  ["cls", "CLS p75", ""],
  ["fcp", "FCP p75", "ms"],
  ["ttfb", "TTFB p75", "ms"],
];

const LAB_METRICS = [
  ["lcp", "Lab LCP", "ms"],
  ["tbt", "Lab TBT", "ms"],
  ["cls", "Lab CLS", ""],
  ["scriptBytes", "Script bytes", "B"],
  ["imageBytes", "Image bytes", "B"],
  ["fontBytes", "Font bytes", "B"],
  ["totalBytes", "Page weight", "B"],
  ["thirdPartyBlockingMs", "Third-party blocking", "ms"],
];

/** Compare two snapshots. Every metric here is "lower is better". */
export function compareSnapshots(baseline, current, tolerance = 0.1) {
  const rows = [];

  walk(baseline?.metrics?.field, current?.metrics?.field, FIELD_METRICS, "field", rows, tolerance);
  walk(baseline?.metrics?.lab, current?.metrics?.lab, LAB_METRICS, "lab", rows, tolerance);

  const regressions = rows.filter((r) => r.verdict === "regressed");
  const improvements = rows.filter((r) => r.verdict === "improved");
  return { rows, regressions, improvements, tolerance };
}

function walk(base, curr, metrics, source, rows, tolerance) {
  for (const [route, devices] of Object.entries(curr || {})) {
    for (const [device, values] of Object.entries(devices || {})) {
      for (const [key, label, unit] of metrics) {
        const after = numeric(values?.[key]);
        const before = numeric(base?.[route]?.[device]?.[key]);
        if (after == null && before == null) continue;
        rows.push(row({ label, unit, source, route, device, before, after, tolerance }));
      }
    }
  }
}

function row({ label, unit, source, route, device, before, after, tolerance }) {
  if (before == null || after == null) {
    return { label, unit, source, route, device, before, after, delta: null, pct: null, verdict: "not-comparable" };
  }
  const delta = after - before;
  const pct = before === 0 ? (after === 0 ? 0 : 1) : delta / before;
  let verdict = "unchanged";
  if (pct > tolerance) verdict = "regressed";
  else if (pct < -tolerance) verdict = "improved";
  return { label, unit, source, route, device, before, after, delta, pct, verdict };
}

export function renderComparison(result, { baseline, current }) {
  const lines = [];
  lines.push(`# Performance regression — ${current?.deploy || current?.generated || "current"} vs ${baseline?.deploy || baseline?.generated || "baseline"}`);
  lines.push("");
  lines.push(`Tolerance: ±${Math.round(result.tolerance * 100)}%. ${result.regressions.length} regression(s), ${result.improvements.length} improvement(s).`);
  lines.push("");
  lines.push("| Metric | Scope | Before | After | Change | Verdict |");
  lines.push("|---|---|---:|---:|---:|---|");
  for (const r of result.rows) {
    if (r.verdict === "unchanged") continue;
    lines.push(`| ${r.label} | ${r.route} · ${r.device} · ${r.source} | ${fmtValue(r.before, r.unit)} | ${fmtValue(r.after, r.unit)} | ${fmtPct(r.pct)} | ${verdictLabel(r.verdict)} |`);
  }
  if (!result.rows.some((r) => r.verdict !== "unchanged")) {
    lines.push("| — | — | — | — | — | No change beyond tolerance |");
  }
  lines.push("");
  if (result.regressions.length) {
    lines.push("## Suspected cause");
    lines.push("");
    lines.push("Correlate the regressed metrics with what shipped in this deploy — new dependencies, a new third-party tag, an image or font change, or a data-fetch move from server to client. Name the change before proposing a fix.");
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const basePath = typeof args.baseline === "string" ? args.baseline : null;
  const currPath = typeof args.current === "string" ? args.current : null;
  if (!basePath || !currPath || !existsSync(basePath) || !existsSync(currPath)) {
    console.error("Usage: compare.mjs --baseline <snapshot.json> --current <snapshot.json> [--tolerance 0.1] [--out REGRESSION.md] [--json] [--report-only]");
    return 2;
  }

  const baseline = JSON.parse(await readFile(basePath, "utf8"));
  const current = JSON.parse(await readFile(currPath, "utf8"));
  const tolerance = Number(args.tolerance) > 0 ? Number(args.tolerance) : 0.1;
  const result = compareSnapshots(baseline, current, tolerance);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderComparison(result, { baseline, current }));
  }
  if (typeof args.out === "string") {
    await writeFile(args.out, renderComparison(result, { baseline, current }), "utf8");
  }

  if (args["report-only"]) return 0;
  return result.regressions.length ? 1 : 0;
}

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtValue(v, unit) {
  if (v == null) return "—";
  if (unit === "B") return v < 1024 ? `${Math.round(v)} B` : v < 1024 * 1024 ? `${Math.round(v / 1024)} KB` : `${(v / 1048576).toFixed(2)} MB`;
  if (unit === "") return Number(v).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${Math.round(v)}${unit}`;
}

function fmtPct(pct) {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${Math.round(pct * 100)}%`;
}

function verdictLabel(v) {
  return { regressed: "❌ regressed", improved: "✅ improved", unchanged: "unchanged", "not-comparable": "⚪ not comparable" }[v] || v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
