#!/usr/bin/env node
// Orchestrator: field + lab + headers + static + MCP capture → findings.json,
// a snapshot for the gates, and the two Markdown deliverables.
//
// URL mode (primary):
//   node run.mjs --url https://example.com [--routes /,/pricing] \
//        [--crux-key KEY] [--psi-key KEY] [--strategy both] [--history] \
//        [--mcp <dir>] [--budgets budgets.json] [--deploy <id>] \
//        [--out PERFORMANCE_AUDIT.md] [--plan-out PERFORMANCE_PLAN.md] [--work <dir>]
//
// Codebase mode (static causes, no measurements):
//   node run.mjs --path ./my-app --out PERFORMANCE_AUDIT.md
//
// Offline mode (fixtures, for tests):
//   node run.mjs --fixtures scripts/fixtures --out /tmp/AUDIT.md
//
// Missing inputs reduce coverage; they never fabricate a result and never crash
// the run. Anything not measured is reported as Info.

import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseArgs, list, int } from "./lib/args.mjs";
import { sampleTtfb, routeOf } from "./lib/fetch.mjs";
import { runAll } from "./checks/index.mjs";
import { renderAudit, renderPlan } from "./report.mjs";
import { mergeBudgets } from "./lib/budgets.mjs";
import { buildSnapshot } from "./lib/snapshot.mjs";
import { hasField } from "./lib/measure.mjs";
import { collectField } from "./crux.mjs";
import { collectLab } from "./psi.mjs";
import { analyzeCodebase } from "./static.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = typeof args.fixtures === "string" ? args.fixtures : null;
  const url = typeof args.url === "string" ? args.url : null;
  const repo = typeof args.path === "string" ? args.path : null;

  if (!url && !repo && !fixtures) {
    console.error("Usage: run.mjs --url <base> | --path <repo> | --fixtures <dir>  [options]  (see the header of this file)");
    return 2;
  }

  const work = typeof args.work === "string" ? args.work : await mkdtemp();
  await mkdir(work, { recursive: true });

  const outPath = typeof args.out === "string" ? args.out : "PERFORMANCE_AUDIT.md";
  const planPath = typeof args["plan-out"] === "string" ? args["plan-out"] : path.join(path.dirname(outPath), "PERFORMANCE_PLAN.md");
  const maxPages = int(args["max-pages"], 10);
  const budgets = mergeBudgets(await readJson(args.budgets));

  const routeList = list(args.routes);
  const routes = (routeList.length ? routeList : ["/"]).slice(0, maxPages).map((r) => ({ route: normalizeRoute(r) }));

  let field = null;
  let lab = null;
  let headers = {};
  let staticInfo = null;
  let mcp = null;

  if (fixtures) {
    field = await readJson(path.join(fixtures, "field.json"));
    lab = await readJson(path.join(fixtures, "lab.json"));
    headers = (await readJson(path.join(fixtures, "headers.json"))) || {};
    mcp = await readJson(path.join(fixtures, "mcp.json"));
  } else if (url) {
    const origin = new URL(url).origin;
    const cruxKey = typeof args["crux-key"] === "string" ? args["crux-key"] : process.env.CRUX_API_KEY || "";
    const psiKey = typeof args["psi-key"] === "string" ? args["psi-key"] : process.env.PSI_API_KEY || "";
    const strategy = typeof args.strategy === "string" ? args.strategy : "both";
    const strategies = strategy === "both" ? ["mobile", "desktop"] : [strategy];

    log(`Collecting field data (CrUX)${cruxKey ? "" : " — no key supplied, PSI will supply field data instead"}…`);
    field = await collectField({ origin, routes: routes.map((r) => r.route), key: cruxKey, history: Boolean(args.history) });

    if (!args["no-lab"]) {
      log(`Running PageSpeed Insights for ${routes.length} route(s) × ${strategies.length} strategy(ies)…`);
      lab = await collectLab({ url: origin, routes: routes.map((r) => r.route), strategies, key: psiKey });
    }

    log("Probing response headers…");
    for (const { route } of routes) {
      const target = new URL(route, origin).toString();
      const { values, last } = await sampleTtfb(target, int(args["ttfb-samples"], 3));
      if (!last) continue;
      headers[route] = {
        url: target,
        status: last.status,
        headers: last.headers,
        redirects: last.redirects,
        bytes: last.bytes,
        ttfbMs: values.length ? Math.min(...values) : last.ttfbMs,
        ttfbSamples: values,
        error: last.error,
      };
    }
  }

  if (repo) {
    log(`Analyzing codebase at ${repo}…`);
    staticInfo = await analyzeCodebase(path.resolve(repo));
  }

  if (typeof args.mcp === "string") {
    mcp = await loadMcpDir(args.mcp);
  }

  const target = url ? new URL(url).origin : repo ? path.resolve(repo) : "fixtures";
  const ctx = { target, routes, field, lab, headers, staticInfo, mcp, budgets };
  const { findings, errors } = runAll(ctx);
  for (const e of errors) console.error(`! check module failed — ${e}`);

  const meta = {
    target,
    date: new Date().toISOString().slice(0, 10),
    mode: modeLabel({ url, repo, fixtures }),
    routes,
    deploy: typeof args.deploy === "string" ? args.deploy : null,
    hasField: hasField(ctx),
    fieldNote: field?.note || null,
    measured: {
      field: describeField(field, ctx),
      lab: describeLab(lab),
      runtime: mcp ? "chrome-devtools MCP capture supplied" : "not measured (no MCP capture)",
    },
    tooling: `node ${process.version}, web-perf-audit 1.0.0`,
  };

  const snapshot = buildSnapshot({ ctx, meta, findings });

  await writeFile(path.join(work, "findings.json"), JSON.stringify({ meta, findings }, null, 2), "utf8");
  await writeFile(path.join(work, "snapshot.json"), JSON.stringify(snapshot, null, 2), "utf8");
  if (field) await writeFile(path.join(work, "field.json"), JSON.stringify(field, null, 2), "utf8");
  if (lab) await writeFile(path.join(work, "lab.json"), JSON.stringify(lab, null, 2), "utf8");

  await writeFile(outPath, renderAudit({ meta, findings, ctx }), "utf8");
  await writeFile(planPath, renderPlan({ meta, findings }), "utf8");

  const fails = findings.filter((f) => f.status === "fail").length;
  const info = findings.filter((f) => f.status === "info").length;
  log(`\nWrote ${outPath} and ${planPath}`);
  log(`  ${fails} substantiated finding(s), ${info} not-measured/informational.`);
  log(`  Working files in ${work} (findings.json, snapshot.json).`);
  if (!meta.hasField && lab) log("  ! No field data — every Core Web Vitals verdict in this report is lab-only.");
  if (!meta.hasField && !lab && url) log("  ! No field or lab data — only response headers were measured. Supply --crux-key/--psi-key, or drop --no-lab, for Core Web Vitals.");
  if (!meta.hasField && !lab && !url) log("  ! Nothing was measured — this report lists static causes only. Run URL mode against a deployed environment for real numbers.");
  return 0;
}

function modeLabel({ url, repo, fixtures }) {
  if (fixtures) return "Fixtures (offline self-test)";
  if (url && repo) return "Live URL + codebase";
  if (url) return "Live URL";
  return "Codebase (static)";
}

function describeField(field, ctx) {
  if (!field) return "not measured";
  const ok = (field.records || []).filter((r) => r.status === "ok").length;
  if (ok) return `${ok} CrUX record(s)${field.history?.status === "ok" ? " + 25-week history" : ""}`;
  return hasField(ctx) ? "PSI loading experience (CrUX-backed)" : "no record (insufficient traffic, or target not publicly reachable)";
}

function describeLab(lab) {
  if (!lab) return "not measured";
  const runs = lab.runs || [];
  const ok = runs.filter((r) => r.status === "ok").length;
  return `${ok}/${runs.length} Lighthouse run(s) via PageSpeed Insights`;
}

/** Merge every JSON file in an MCP capture directory into one object. */
async function loadMcpDir(dir) {
  if (!existsSync(dir)) return null;
  const merged = {};
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const data = await readJson(path.join(dir, name));
    if (!data) continue;
    if (Array.isArray(data)) {
      const key = path.basename(name, ".json");
      merged[key] = (merged[key] || []).concat(data);
      continue;
    }
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) merged[k] = (merged[k] || []).concat(v);
      else merged[k] = v;
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function normalizeRoute(r) {
  if (/^https?:\/\//i.test(r)) return routeOf(r);
  return r.startsWith("/") ? r : `/${r}`;
}

async function readJson(file) {
  if (!file || file === true || !existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function mkdtemp() {
  return path.join(os.tmpdir(), `web-perf-audit-${Date.now()}`);
}

function log(msg) {
  console.log(msg);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`run.mjs failed: ${err?.stack || err}`);
    process.exit(1);
  });
}

export { main };
