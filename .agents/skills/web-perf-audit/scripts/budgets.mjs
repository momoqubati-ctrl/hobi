#!/usr/bin/env node
// Performance budget gate — usable in CI.
//
//   node budgets.mjs --measured <snapshot.json|field.json|lab.json> [--budgets budgets.json] [--json]
//
// Exit 0 when every budget with a measurement passes, 1 when any is breached, 2
// on bad input. A budget with no measurement is reported as `not measured` and
// does not pass — silence is not success.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "./lib/args.mjs";
import { mergeBudgets, checkBudgets, DEFAULT_BUDGETS } from "./lib/budgets.mjs";
import { normalizeRecord } from "./crux.mjs";

const STATUS = { pass: "PASS", fail: "FAIL", "not-measured": "n/a " };

/** Accept a run.mjs snapshot, a crux.mjs field.json, or a psi.mjs lab.json. */
export function toSnapshot(data) {
  if (!data) return null;
  if (data.metrics?.field || data.metrics?.lab) return data;

  if (Array.isArray(data.records)) {
    const field = {};
    for (const rec of data.records) {
      if (rec.status !== "ok") continue;
      const route = rec.route || "/";
      const device = rec.formFactor === "DESKTOP" ? "desktop" : "mobile";
      const metrics = rec.record?.metrics || normalizeRecord(rec.record || {}).metrics;
      field[route] = field[route] || {};
      field[route][device] = {
        lcp: metrics?.lcp?.p75 ?? null,
        inp: metrics?.inp?.p75 ?? null,
        cls: metrics?.cls?.p75 ?? null,
        fcp: metrics?.fcp?.p75 ?? null,
        ttfb: metrics?.ttfb?.p75 ?? null,
      };
    }
    return { target: data.origin, generated: data.generated, metrics: { field, lab: {} } };
  }

  if (Array.isArray(data.runs)) {
    const lab = {};
    const field = {};
    for (const run of data.runs) {
      if (run.status !== "ok") continue;
      const route = safeRoute(run.url);
      const device = run.strategy === "desktop" ? "desktop" : "mobile";
      lab[route] = lab[route] || {};
      lab[route][device] = {
        lcp: run.lighthouse?.metrics?.lcp ?? null,
        cls: run.lighthouse?.metrics?.cls ?? null,
        tbt: run.lighthouse?.metrics?.tbt ?? null,
        ttfb: run.lighthouse?.metrics?.ttfb ?? null,
        totalBytes: run.lighthouse?.audits?.["total-byte-weight"]?.numericValue ?? null,
      };
      const m = run.field?.metrics;
      if (m) {
        field[route] = field[route] || {};
        field[route][device] = {
          lcp: m.lcp?.p75 ?? null,
          inp: m.inp?.p75 ?? null,
          cls: m.cls?.p75 ?? null,
          fcp: m.fcp?.p75 ?? null,
          ttfb: m.ttfb?.p75 ?? null,
        };
      }
    }
    return { target: data.target, generated: data.generated, metrics: { field, lab } };
  }
  return null;
}

export function renderBudgetTable(result) {
  const lines = [];
  lines.push("| Budget | Scope | Limit | Measured | Status |");
  lines.push("|---|---|---:|---:|---|");
  for (const r of result.rows) {
    const measured = r.measured == null ? "not measured" : `${r.measured}${r.unit}`;
    lines.push(`| ${r.label} | ${r.scope} | ${r.budget}${r.unit} | ${measured} | ${r.status === "pass" ? "✅ pass" : r.status === "fail" ? "❌ over budget" : "⚪ not measured"} |`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const measuredPath = typeof args.measured === "string" ? args.measured : null;
  if (!measuredPath || !existsSync(measuredPath)) {
    console.error("Usage: budgets.mjs --measured <snapshot.json|field.json|lab.json> [--budgets budgets.json] [--json] [--out report.md]");
    return 2;
  }

  const raw = JSON.parse(await readFile(measuredPath, "utf8"));
  const snapshot = toSnapshot(raw);
  if (!snapshot) {
    console.error(`Could not interpret ${measuredPath} as a snapshot, CrUX field file, or PSI lab file.`);
    return 2;
  }

  const custom = typeof args.budgets === "string" && existsSync(args.budgets)
    ? JSON.parse(await readFile(args.budgets, "utf8"))
    : null;
  const budgets = mergeBudgets(custom);
  const result = checkBudgets(snapshot, budgets);

  if (args.json) {
    console.log(JSON.stringify({ target: snapshot.target, budgets, ...result }, null, 2));
  } else {
    console.log(`Performance budgets — ${snapshot.target || measuredPath}${custom ? "" : " (defaults)"}\n`);
    for (const r of result.rows) {
      const measured = r.measured == null ? "not measured" : `${r.measured}${r.unit}`;
      console.log(`  [${STATUS[r.status]}] ${r.label.padEnd(20)} ${r.scope.padEnd(34)} limit ${String(r.budget) + r.unit}`.padEnd(110) + ` measured ${measured}`);
    }
    const notMeasured = result.rows.filter((r) => r.status === "not-measured").length;
    console.log(`\n${result.checked} budget(s) checked · ${result.breached.length} breached · ${notMeasured} not measured.`);
    if (!custom) console.log("Using default budgets — adapt them to this project in a budgets.json (see assets/budgets.example.json).");
  }

  if (typeof args.out === "string") {
    await writeFile(args.out, `# Performance budgets — ${snapshot.target || ""}\n\n${renderBudgetTable(result)}\n`, "utf8");
  }

  return result.breached.length ? 1 : 0;
}

function safeRoute(url) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}

export { DEFAULT_BUDGETS };
