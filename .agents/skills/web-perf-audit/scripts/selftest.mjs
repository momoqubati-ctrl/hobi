// Offline sanity tests for the check engine, the report renderer and the gates.
// No network, no keys, no dependencies. Run: node scripts/selftest.mjs
// Exit 0 = pass, 1 = fail.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAll } from "./checks/index.mjs";
import { renderAudit, renderPlan, assignDisplayIds } from "./report.mjs";
import { approxPercentile, distribution, percentile } from "./lib/percentiles.mjs";
import { rate, severityFor, fmt } from "./lib/thresholds.mjs";
import { finding, computePriority, performanceScore, scorecard } from "./lib/findings.mjs";
import { checkBudgets, mergeBudgets, DEFAULT_BUDGETS } from "./lib/budgets.mjs";
import { compareSnapshots } from "./compare.mjs";
import { normalizeRecord } from "./crux.mjs";
import { normalizeFieldExperience } from "./psi.mjs";
import { buildSnapshot } from "./lib/snapshot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const errors = [];
const assert = (cond, msg) => { if (!cond) errors.push(msg); };
const fixture = async (name) => JSON.parse(await readFile(path.join(here, "fixtures", name), "utf8"));

// --- percentiles ------------------------------------------------------------
{
  const hist = [{ start: 0, end: 2500, density: 0.6 }, { start: 2500, end: 4000, density: 0.25 }, { start: 4000, density: 0.15 }];
  const p50 = approxPercentile(hist, 50);
  assert(p50 && p50.approximate === true, "p50 from a histogram must be flagged approximate");
  assert(p50 && p50.value > 2000 && p50.value < 2500, `p50 interpolation out of range: ${JSON.stringify(p50)}`);
  assert(approxPercentile(hist, 95) === null, "p95 falls in the open-ended tail bin and must be null, never estimated");
  const dist = distribution(hist);
  assert(dist.good === 0.6 && dist.poor === 0.15, "histogram distribution mis-read");
  assert(percentile([1, 2, 3, 4], 50) === 2.5, "exact percentile helper is wrong");
}

// --- thresholds -------------------------------------------------------------
{
  assert(rate("lcp", 2500) === "good" && rate("lcp", 2501) === "needs-improvement" && rate("lcp", 4001) === "poor", "LCP banding is wrong");
  assert(rate("cls", 0.1) === "good" && rate("cls", 0.26) === "poor", "CLS banding is wrong");
  assert(severityFor("inp", 150) === null, "a good metric must not produce a severity");
  assert(severityFor("inp", 600) === "high", "a poor metric must be high severity");
  assert(fmt("cls", 0.1) === "0.1" && fmt("lcp", 2499.6) === "2500ms", `formatting is wrong: ${fmt("cls", 0.1)} / ${fmt("lcp", 2499.6)}`);
}

// --- finding model ----------------------------------------------------------
{
  let threw = false;
  try { finding({ id: "X", title: "t", severity: "high", category: "lcp" }); } catch { threw = true; }
  assert(threw, "a fail finding without evidence must throw");

  threw = false;
  try { finding({ id: "X", title: "t", severity: "info", category: "lcp", evidence: "e" }); } catch { threw = true; }
  assert(threw, "an info-severity finding cannot have status fail");

  assert(computePriority({ severity: "high", frequency: 4, exposure: 4, confidence: 1 }) === "P0", "high + always + everyone must be P0");
  assert(computePriority({ severity: "low", frequency: 1, exposure: 1, confidence: 0.5 }) === "P3", "low + rare + narrow must be P3");
  assert(computePriority({ severity: "critical", frequency: 1, exposure: 1, confidence: 0.5 }) === "P1", "a critical finding is never below P1");
  assert(computePriority({ severity: "info", status: "info" }) === null, "informational findings have no priority");

  const f = finding({ id: "A", title: "t", severity: "medium", category: "lcp", evidence: "e" });
  const info = finding({ id: "B", title: "t", severity: "info", category: "rum", status: "info", evidence: "" });
  assert(performanceScore([f, info]) === 96, "info findings must not affect the score");
  const card = scorecard([info]);
  assert(card.find((r) => r.category === "rum").status === "Not measured", "an info-only area is 'Not measured', never 'Good'");
}

// --- API normalizers --------------------------------------------------------
{
  const rec = normalizeRecord({ metrics: { cumulative_layout_shift: { histogram: [{ start: 0, end: 0.1, density: 0.7 }, { start: 0.1, end: 0.25, density: 0.2 }, { start: 0.25, density: 0.1 }], percentiles: { p75: "0.14" } } } });
  assert(rec.metrics.cls.p75 === 0.14, "CrUX returns CLS as a string; it must be coerced to a number");
  assert(rec.metrics.cls.p95 === null, "p95 must never be synthesised");

  const psi = normalizeFieldExperience({ metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 14, distributions: [{ proportion: 0.7 }, { proportion: 0.2 }, { proportion: 0.1 }] } } });
  assert(psi.metrics.cls.p75 === 0.14, `PSI reports CLS as hundredths and must be scaled: got ${psi.metrics.cls.p75}`);
}

// --- engine against fixtures ------------------------------------------------
{
  const ctx = {
    target: "https://example.com",
    routes: [{ route: "/" }],
    field: await fixture("field.json"),
    lab: await fixture("lab.json"),
    headers: await fixture("headers.json"),
    mcp: await fixture("mcp.json"),
    staticInfo: null,
    budgets: mergeBudgets(null),
  };
  const { findings, errors: moduleErrors } = runAll(ctx);
  assert(!moduleErrors.length, `check modules threw: ${moduleErrors.join("; ")}`);

  const has = (id, predicate = () => true) => findings.some((f) => f.id === id && predicate(f));
  const expected = [
    ["CWV-LCP-P75", (f) => f.devices === "mobile"],
    ["CWV-INP-P75", (f) => f.devices === "mobile"],
    ["CWV-CLS-P75", (f) => f.devices === "mobile"],
    ["TREND-LCP-REGRESSION"],
    ["LCP-IMAGE-LAZY"],
    ["LCP-IMAGE-UNPRIORITIZED"],
    ["CLS-SHIFTING-ELEMENTS"],
    ["INP-MAIN-THREAD-BLOCKING"],
    ["JS-ROUTE-WEIGHT"],
    ["JS-UNUSED"],
    ["JS-DUPLICATED"],
    ["JS-EXECUTION-TIME"],
    ["NET-RENDER-BLOCKING"],
    ["NET-NO-COMPRESSION"],
    ["NET-SHORT-CACHE-TTL"],
    ["NET-REDIRECT-CHAIN"],
    ["NET-HTML-UNCOMPRESSED"],
    ["NET-NO-SERVER-TIMING", (f) => f.status === "info"],
    ["TTFB-ORIGIN-SLOW"],
    ["API-SLOW"],
    ["API-VERY-SLOW"],
    ["API-DUPLICATE-REQUESTS"],
    ["API-N-PLUS-ONE"],
    ["API-LARGE-PAYLOAD"],
    ["IMG-OVERSIZED"],
    ["IMG-LEGACY-FORMAT"],
    ["IMG-NO-DIMENSIONS"],
    ["FONT-DISPLAY-BLOCKING"],
    ["FONT-THIRD-PARTY-HOSTED"],
    ["TP-BLOCKING-TIME"],
    ["TP-DOMINANT-ENTITY"],
    ["RUNTIME-INP-ATTRIBUTION"],
    ["RUNTIME-SLOW-ROUTE-TRANSITION"],
    ["RUNTIME-MEMORY-GROWTH"],
  ];
  for (const [id, predicate] of expected) assert(has(id, predicate), `expected finding ${id} did not fire against the fixtures`);

  // Desktop in the fixture is healthy: no desktop CWV failure may be reported.
  assert(!findings.some((f) => f.id === "CWV-LCP-P75" && f.devices === "desktop"), "a good desktop LCP must not produce a finding");
  // Field data exists, so the "no field data" notice must not fire.
  assert(!has("RUM-FIELD-UNAVAILABLE"), "field data was supplied; the not-measured notice must stay silent");
  // Every substantiated finding must carry evidence and a priority.
  for (const f of findings.filter((x) => x.status === "fail")) {
    assert(f.evidence.length > 0, `${f.id} is a fail with no evidence`);
    assert(Boolean(f.priority), `${f.id} is a fail with no computed priority`);
  }

  // --- report rendering -----------------------------------------------------
  const meta = {
    target: "https://example.com",
    date: "2026-08-21",
    mode: "Live URL",
    routes: ctx.routes,
    deploy: "test",
    hasField: true,
    measured: { field: "4 CrUX record(s)", lab: "2/2 Lighthouse run(s)", runtime: "MCP capture supplied" },
    tooling: "selftest",
  };
  const audit = renderAudit({ meta, findings, ctx });
  for (const heading of ["## Executive Summary", "## Performance Scorecard", "## RUM Results", "## Findings", "## Prioritization", "## Verification", "## Appendix / Methodology"]) {
    assert(audit.includes(heading), `rendered audit is missing ${heading}`);
  }
  assert(/#### PERF-001 · `/.test(audit), "rendered audit has no numbered finding blocks");
  assert(audit.includes("not available"), "the audit must state which percentiles are not derivable");
  assert(!/\{\{/.test(audit), "rendered audit still contains template tokens");

  const plan = renderPlan({ meta, findings });
  for (const heading of ["## Phase 1 — Critical", "## Phase 6 — RUM & Regression Monitoring", "## Verification"]) {
    assert(plan.includes(heading), `rendered plan is missing ${heading}`);
  }
  const numbered = assignDisplayIds(findings);
  assert(numbered[0].displayId === "PERF-001", "display ids must start at PERF-001");
  assert(numbered.every((f, i) => !i || f.status === "fail" || numbered[i - 1].status !== "info" || f.status === "info"), "informational findings must sort after substantiated ones");

  // --- gates ----------------------------------------------------------------
  const snapshot = buildSnapshot({ ctx, meta, findings });
  assert(snapshot.metrics.field["/"].mobile.lcp === 3800, "snapshot lost the field p75");
  assert(snapshot.metrics.lab["/"].mobile.scriptBytes === 690000, "snapshot lost the lab script weight");

  const budgetResult = checkBudgets(snapshot, DEFAULT_BUDGETS);
  assert(budgetResult.breached.some((r) => r.label === "LCP p75" && r.scope.includes("mobile")), "budget gate missed a breached mobile LCP");
  assert(budgetResult.rows.some((r) => r.status === "pass"), "budget gate reported no passes at all");

  const worse = structuredClone(snapshot);
  worse.metrics.field["/"].mobile.lcp = 5000;
  worse.metrics.lab["/"].mobile.scriptBytes = 1_200_000;
  const cmp = compareSnapshots(snapshot, worse, 0.1);
  assert(cmp.regressions.some((r) => r.label === "LCP p75"), "regression gate missed a 32% LCP regression");
  assert(cmp.regressions.some((r) => r.label === "Script bytes"), "regression gate missed a bundle-size regression");
  const same = compareSnapshots(snapshot, snapshot, 0.1);
  assert(!same.regressions.length, "comparing a snapshot with itself must report no regression");

  const missing = compareSnapshots({ metrics: { field: {}, lab: {} } }, snapshot, 0.1);
  assert(missing.rows.every((r) => r.verdict !== "regressed"), "a missing baseline must not be reported as a regression");
}

// --- no-field-data path -----------------------------------------------------
{
  const ctx = {
    target: "https://internal.example",
    routes: [{ route: "/" }],
    field: { source: "crux", available: false, records: [], note: "No CrUX API key supplied." },
    lab: null,
    headers: {},
    mcp: null,
    staticInfo: null,
    budgets: mergeBudgets(null),
  };
  const { findings } = runAll(ctx);
  assert(findings.some((f) => f.id === "RUM-FIELD-UNAVAILABLE" && f.status === "info"), "with no field data the audit must say so, as Info");
  assert(findings.some((f) => f.id === "RUNTIME-NOT-MEASURED" && f.status === "info"), "with no MCP capture, runtime must be reported as not measured");
  assert(!findings.some((f) => f.status === "fail"), "with nothing measured, nothing may be failed");

  const audit = renderAudit({
    meta: { target: ctx.target, date: "2026-08-21", mode: "Live URL", routes: ctx.routes, hasField: false, fieldNote: ctx.field.note, measured: { field: "not measured", lab: "not measured", runtime: "not measured" }, tooling: "selftest" },
    findings,
    ctx,
  });
  assert(audit.includes("No field (RUM) data was available"), "the audit must lead with the missing-field-data warning");
  assert(/Performance score:\*\* 100\/100/.test(audit), "with no substantiated findings the score stays 100");
}

if (errors.length) {
  console.error(`Self-test FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("Self-test passed: percentiles, thresholds, finding model, API normalizers, all 9 check modules, report rendering, budget and regression gates.");
