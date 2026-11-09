// Renders the two deliverables from findings.json:
//   PERFORMANCE_AUDIT.md — what was measured, what is wrong, ranked
//   PERFORMANCE_PLAN.md  — the same findings organized into six delivery phases
//
// Both match assets/*_TEMPLATE.md exactly so validate-report.py passes on the
// generated baseline and on the version the agent finalizes.

import {
  BADGE, SEV_LABEL, CATEGORY_LABEL, bySeverity, byPriority, countBySeverity,
  countByPriority, performanceScore, band, scorecard,
} from "./lib/findings.mjs";
import { THRESHOLDS, fmt, rate } from "./lib/thresholds.mjs";
import { fieldFor, sourceLabel } from "./lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];
const EFFORT_LABEL = { low: "Low", medium: "Medium", high: "High" };

export function renderAudit({ meta, findings, ctx }) {
  const counts = countBySeverity(findings);
  const priorities = countByPriority(findings);
  const score = performanceScore(findings);
  const out = [];

  out.push(`# Web Performance & RUM Audit — ${meta.target}`);
  out.push("");
  out.push("| | |");
  out.push("|---|---|");
  out.push(`| **Target** | ${meta.target} |`);
  out.push(`| **Date** | ${meta.date} |`);
  out.push(`| **Mode** | ${meta.mode} |`);
  out.push(`| **Routes audited** | ${meta.routes.length} |`);
  out.push(`| **Field (RUM) data** | ${meta.measured.field} |`);
  out.push(`| **Lab data** | ${meta.measured.lab} |`);
  out.push(`| **Runtime capture** | ${meta.measured.runtime} |`);
  out.push(`| **Tooling** | ${meta.tooling} |`);
  out.push("");

  out.push("## Executive Summary");
  out.push("");
  out.push(`- **Performance score:** ${score}/100 (${band(score)})`);
  out.push(`- **Findings:** ${counts.critical} Critical · ${counts.high} High · ${counts.medium} Medium · ${counts.low} Low · ${counts.info} Info`);
  out.push(`- **Priority:** ${priorities.P0} P0 · ${priorities.P1} P1 · ${priorities.P2} P2 · ${priorities.P3} P3`);
  out.push("");
  out.push(verdict({ score, counts, priorities, meta, findings }));
  out.push("");

  out.push("## Performance Scorecard");
  out.push("");
  out.push("| Area | Status | Severity | Findings |");
  out.push("|---|---|---|---|");
  for (const row of scorecard(findings)) {
    const severity = row.count ? SEV_LABEL[row.severity] : "—";
    out.push(`| ${CATEGORY_LABEL[row.category]} | ${row.status} | ${severity} | ${row.count || "—"} |`);
  }
  out.push("");
  out.push("_Status is derived from measurements only. **Not measured** means exactly that — it is never a pass._");
  out.push("");

  out.push("## RUM Results");
  out.push("");
  out.push(...rumSection(ctx, meta));

  out.push("## Findings");
  out.push("");
  const numbered = assignDisplayIds(findings);
  if (!numbered.length) {
    out.push("_No findings were produced. Confirm the run actually measured something before reading this as a pass._");
    out.push("");
  }
  const site = numbered.filter((f) => f.scope === "site");
  if (site.length) {
    out.push("### Site-Wide");
    out.push("");
    for (const f of site) out.push(renderFinding(f));
  }
  const routes = [...new Set(numbered.filter((f) => f.scope === "page").map((f) => f.route))];
  for (const route of routes) {
    out.push(`### \`${route}\``);
    out.push("");
    for (const f of numbered.filter((x) => x.scope === "page" && x.route === route)) out.push(renderFinding(f));
  }

  out.push("## Prioritization");
  out.push("");
  out.push("Every substantiated finding, ranked. Priority is computed as `impact × frequency × user exposure × fix confidence` — see `references/SEVERITY_RUBRIC.md`.");
  out.push("");
  out.push("| # | Priority | Severity | Area | Scope | Finding | Effort |");
  out.push("|---|---|---|---|---|---|---|");
  const ranked = numbered.filter((f) => f.status === "fail").sort(byPriority);
  if (!ranked.length) {
    out.push("| — | — | — | — | — | _No substantiated defects._ | — |");
  }
  for (const f of ranked) {
    const scope = f.scope === "site" ? "site-wide" : `\`${f.route}\``;
    out.push(`| ${f.displayId} | ${f.priority} | ${SEV_LABEL[f.severity]} | ${CATEGORY_LABEL[f.category]} | ${scope} | ${escapePipes(f.title)} | ${EFFORT_LABEL[f.effort]} |`);
  }
  out.push("");
  const notMeasured = numbered.filter((f) => f.status === "info");
  if (notMeasured.length) {
    out.push("**Not measured / informational** (never scored, never treated as a pass):");
    out.push("");
    for (const f of notMeasured) out.push(`- ${f.displayId} · \`${f.id}\` — ${escapePipes(f.title)}`);
    out.push("");
  }

  out.push("## Verification");
  out.push("");
  out.push("Each fix must be re-measured in **both** lab and field before it is closed.");
  out.push("");
  out.push("| Step | Command / method | Closes on |");
  out.push("|---|---|---|");
  out.push(`| Lab re-run | \`node scripts/psi.mjs --url ${meta.target} --strategy both --out lab-after.json\` | The specific audit that produced the finding no longer fires |`);
  out.push(`| Field re-check | \`node scripts/crux.mjs --origin ${meta.target} --history --out field-after.json\` | p75 moves into the target band (allow 28 days for the CrUX window to roll) |`);
  out.push("| Budget gate | `node scripts/budgets.mjs --measured field-after.json --budgets budgets.json` | Exit code 0 |");
  out.push("| Regression gate | `node scripts/compare.mjs --baseline baseline.json --current current.json` | No metric regressed beyond its tolerance |");
  out.push("");
  out.push("A Lighthouse improvement alone does not close a finding. Field p75 is the production signal.");
  out.push("");

  out.push("## Appendix / Methodology");
  out.push("");
  out.push(`- **What was measured:** field (RUM) — ${meta.measured.field}; lab — ${meta.measured.lab}; runtime — ${meta.measured.runtime}.`);
  out.push("- **Thresholds:** Google Core Web Vitals cut-offs — LCP 2.5s/4s, INP 200ms/500ms, CLS 0.1/0.25, FCP 1.8s/3s, TTFB 0.8s/1.8s. A metric is `good` at or below the first number and `poor` above the second.");
  out.push("- **Percentiles:** CrUX and PSI publish **p75 only**. p50/p90 shown as `approx` are interpolated from the three-bin histogram; p95/p99 fall in the open-ended tail bin and are reported as `not available` rather than estimated.");
  out.push("- **Scoring:** start at 100, subtract Critical −20 / High −10 / Medium −4 / Low −1, clamped 0–100. Informational findings never affect the score.");
  out.push("- **Priority:** `impact × frequency × user exposure × fix confidence`; P0 ≥ 36, P1 ≥ 18, P2 ≥ 8, else P3. A Critical finding is never below P1.");
  out.push("- **Not measured items** are reported as `Info`. They are not passes.");
  out.push(`- **Re-run:** \`node scripts/run.mjs --url ${meta.target} --routes ${meta.routes.map((r) => r.route).join(",")} --out PERFORMANCE_AUDIT.md\``);
  out.push("");

  return out.join("\n");
}

export function renderPlan({ meta, findings }) {
  const numbered = assignDisplayIds(findings);
  // One task per stable check id: the same fix should not appear once per device.
  const fails = mergeByCheckId(numbered.filter((f) => f.status === "fail"));
  const used = new Set();

  const phase1 = take(fails, used, (f) => f.priority === "P0");
  const phase2 = take(fails, used, (f) => ["lcp", "inp", "cls", "ttfb"].includes(f.category));
  const phase3 = take(fails, used, (f) => ["api", "caching"].includes(f.category));
  const phase4 = take(fails, used, (f) => ["javascript", "runtime"].includes(f.category));
  const phase5 = take(fails, used, (f) => ["images", "fonts", "thirdparty"].includes(f.category));
  const phase6 = take(fails, used, () => true);

  const out = [];
  out.push(`# Performance Implementation Plan — ${meta.target}`);
  out.push("");
  out.push(`Generated ${meta.date} from \`PERFORMANCE_AUDIT.md\`. Every task carries the audit's issue ID; do not start one without re-reading its finding.`);
  out.push("");
  out.push("## Overview");
  out.push("");
  out.push("| Phase | Focus | Tasks |");
  out.push("|---|---|---|");
  out.push(`| 1 | Critical production issues | ${phase1.length} |`);
  out.push(`| 2 | Core Web Vitals | ${phase2.length} |`);
  out.push(`| 3 | Network & APIs | ${phase3.length} |`);
  out.push(`| 4 | JavaScript & rendering | ${phase4.length} |`);
  out.push(`| 5 | Assets (images, fonts, third party) | ${phase5.length} |`);
  out.push(`| 6 | RUM & regression monitoring | ${phase6.length + 3} |`);
  out.push("");
  out.push("Rules for the whole plan: measure before and after every task; never break UI or business logic to win a metric; never add caching to hide a slow query; confirm each improvement in field data, not only in the lab.");
  out.push("");

  out.push(...phaseSection("## Phase 1 — Critical", "Production issues affecting customers right now. Nothing else starts until these are done or explicitly deferred.", phase1));
  out.push(...phaseSection("## Phase 2 — Core Web Vitals", "LCP, INP, CLS and TTFB work that did not already land in Phase 1.", phase2));
  out.push(...phaseSection("## Phase 3 — Network & APIs", "Waterfalls, endpoint latency, payload size, compression and caching correctness.", phase3));
  out.push(...phaseSection("## Phase 4 — JavaScript & Rendering", "Bundle size, hydration, execution cost and post-load runtime behaviour.", phase4));
  out.push(...phaseSection("## Phase 5 — Assets", "Images, fonts and third-party scripts.", phase5));

  out.push("## Phase 6 — RUM & Regression Monitoring");
  out.push("");
  out.push("Continuous measurement, so the next regression is caught by a gate instead of by a customer.");
  out.push("");
  out.push(...phaseTasks(phase6));
  out.push("| Standing | Task | Files / components | Expected impact | Risk | Complexity | Verification |");
  out.push("|---|---|---|---|---|---|---|");
  out.push("| RUM-1 | Ship a first-party web-vitals beacon with the attribution build and the dimensions in `references/RUM_IMPLEMENTATION.md` | app entry point, `/api/vitals` handler | Route- and device-level p75/p95 within days | Low — measurement only; collect no PII | Medium | Beacon rows arrive for every route with correct device/connection/deploy fields |");
  out.push("| RUM-2 | Add a per-deploy performance gate | CI pipeline, `scripts/budgets.mjs`, `scripts/compare.mjs` | Regressions fail the build instead of shipping | Low | Low | Deliberately regress a budget locally and confirm a non-zero exit |");
  out.push("| RUM-3 | Publish the dashboard: CWV p75 by route and device, trends, worst routes, deploy markers | dashboard/BI tool | One place that answers \"did that deploy hurt?\" | Low | Medium | Every panel in `references/BUDGETS_REGRESSION.md` renders from real data |");
  out.push("");

  out.push("## Verification");
  out.push("");
  out.push("For every completed task, record the comparison in the task's PR:");
  out.push("");
  out.push("```text");
  out.push("Issue:     <PERF-NNN / stable-id>");
  out.push("Metric:    <e.g. LCP p75, mobile, /products>");
  out.push("Before:    <value + source + date>");
  out.push("After:     <value + source + date>");
  out.push("Change:    <absolute + %>");
  out.push("Confirmed: lab <yes/no> · field <yes/no — note the 28-day CrUX window>");
  out.push("```");
  out.push("");
  out.push("A task is done when the lab audit no longer fires **and** the field metric moves. If the lab improves but the field does not, the diagnosis was wrong — reopen the finding.");
  out.push("");

  return out.join("\n");
}

function phaseSection(heading, blurb, items) {
  const out = [heading, "", blurb, ""];
  if (!items.length) {
    out.push("_No tasks in this phase._");
    out.push("");
    return out;
  }
  out.push(...phaseTasks(items));
  return out;
}

function phaseTasks(items) {
  if (!items.length) return [];
  const out = [];
  out.push("| # | Issue | Task | Affected | Files / components | Expected impact | Risk | Complexity | Verification |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const f of items) {
    out.push(
      `| ${f.displayId} | \`${f.id}\` | ${escapePipes(f.recommendation || f.title)} | ${escapePipes(f.affected || scopeLabel(f))} | ${escapePipes(filesFor(f))} | ${escapePipes(f.expectedImprovement || f.targetValue || "—")} | ${escapePipes(riskFor(f))} | ${EFFORT_LABEL[f.effort]} | ${escapePipes(verificationFor(f))} |`,
    );
  }
  out.push("");
  return out;
}

/**
 * Collapse findings that share a stable check id into one task. The same fix on
 * mobile and desktop is one piece of work; the audit still lists both findings.
 */
function mergeByCheckId(findings) {
  const groups = new Map();
  for (const f of findings) {
    const list = groups.get(f.id) || [];
    list.push(f);
    groups.set(f.id, list);
  }
  const merged = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(byPriority);
    const lead = sorted[0];
    const scopes = [...new Set(sorted.map(scopeLabel))];
    merged.push({ ...lead, affected: scopes.join(", "), mergedCount: sorted.length });
  }
  return merged;
}

function scopeLabel(f) {
  const where = f.scope === "site" ? "site-wide" : `\`${f.route}\``;
  return f.devices && f.devices !== "all" ? `${where} (${f.devices})` : where;
}

function filesFor(f) {
  if (f.source === "static") return "see the file list in the finding's evidence";
  if (f.scope === "page") return `route \`${f.route}\` — resources named in the finding's evidence`;
  return "site-wide configuration (server, CDN, or app entry)";
}

function riskFor(f) {
  const byCategory = {
    api: "Medium — backend change; verify correctness, not just latency",
    ttfb: "Medium — backend/infra change; verify correctness, not just latency",
    thirdparty: "Medium — confirm with the integration owner that the tag still fires",
    caching: "Medium — wrong TTLs serve stale content; fingerprint assets before extending them",
    javascript: "Medium — behaviour change; cover with tests",
    runtime: "Medium — behaviour change; cover with tests",
    inp: "Medium — touches event handling and rendering; cover with tests",
    lcp: "Low/Medium — mostly markup and request ordering; check the element still renders",
    cls: "Low — layout reservation; verify on the narrowest supported viewport",
    images: "Low — asset pipeline change; check art direction survives",
    fonts: "Low — check the rendered typeface and fallback metrics",
    rum: "Low — measurement only; collect no PII",
  };
  return byCategory[f.category] || "Low — configuration change";
}

function verificationFor(f) {
  const route = f.route || "the affected route";
  const fieldMetric = {
    lcp: "LCP p75",
    inp: "INP p75",
    cls: "CLS p75",
    ttfb: "TTFB p75",
    javascript: "INP p75 (and the route bundle size in the build output)",
    runtime: "INP p75",
    images: "LCP p75",
    fonts: "LCP p75",
    thirdparty: "INP p75",
    caching: "TTFB p75 for repeat visits",
    api: "the endpoint p95 in server-side APM",
    rum: "beacon rows arriving with the expected dimensions",
  }[f.category] || "the affected field metric";
  return `Lab: the source audit stops firing. Field: ${fieldMetric} on \`${route}\` improves (allow the 28-day CrUX window)`;
}

function take(all, used, predicate) {
  const picked = all.filter((f) => !used.has(f.displayId) && predicate(f)).sort(byPriority);
  for (const f of picked) used.add(f.displayId);
  return picked;
}

/** Sequential PERF-NNN display ids in priority order; stable ids are kept alongside. */
export function assignDisplayIds(findings) {
  const ordered = [...findings].sort((a, b) => {
    const aFail = a.status === "fail" ? 0 : 1;
    const bFail = b.status === "fail" ? 0 : 1;
    if (aFail !== bFail) return aFail - bFail;
    return aFail === 0 ? byPriority(a, b) : bySeverity(a, b);
  });
  return ordered.map((f, i) => ({ ...f, displayId: `PERF-${String(i + 1).padStart(3, "0")}` }));
}

function renderFinding(f) {
  const lines = [];
  lines.push(`#### ${f.displayId} · \`${f.id}\` — ${f.title}`);
  lines.push("");
  if (f.status === "info") lines.push("> Informational / not measured — this is not a pass and does not affect the score.\n");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| **Severity** | ${BADGE[f.severity]} |`);
  if (f.priority) lines.push(`| **Priority** | ${f.priority} |`);
  lines.push(`| **Area** | ${CATEGORY_LABEL[f.category]} |`);
  lines.push(`| **Affected route** | ${f.scope === "site" ? "site-wide" : `\`${f.route}\``} |`);
  lines.push(`| **Affected devices** | ${f.devices} |`);
  if (f.metric) lines.push(`| **Observed metric** | ${escapePipes(f.metric)} |`);
  if (f.currentValue) lines.push(`| **Current value** | ${escapePipes(f.currentValue)} |`);
  if (f.targetValue) lines.push(`| **Target value** | ${escapePipes(f.targetValue)} |`);
  lines.push(`| **Effort** | ${EFFORT_LABEL[f.effort]} |`);
  if (f.source) lines.push(`| **Source** | ${sourceName(f.source)} |`);
  lines.push("");
  if (f.evidence) {
    lines.push("**Evidence**");
    lines.push("");
    lines.push(fence("text", f.evidence));
    lines.push("");
  }
  if (f.rootCause) lines.push(`**Root cause:** ${f.rootCause}\n`);
  if (f.userImpact) lines.push(`**User impact:** ${f.userImpact}\n`);
  if (f.businessImpact) lines.push(`**Business impact:** ${f.businessImpact}\n`);
  if (f.recommendation) lines.push(`**Recommended fix:** ${f.recommendation}\n`);
  if (f.fixSnippet) {
    lines.push(fence(f.fixLang || "", f.fixSnippet));
    lines.push("");
  }
  if (f.expectedImprovement) lines.push(`**Expected improvement:** ${f.expectedImprovement}\n`);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function rumSection(ctx, meta) {
  const out = [];
  if (!ctx || !meta.hasField) {
    out.push("**No field (RUM) data was available for this target.**");
    out.push("");
    out.push(meta.fieldNote || "CrUX returned no record and PageSpeed Insights reported no loading experience. Every Core Web Vitals verdict in this report is therefore lab-only.");
    out.push("");
    out.push("Lab measurements describe one synthetic device on one network from one location. They cannot stand in for field data — see `references/RUM_IMPLEMENTATION.md` to close the gap.");
    out.push("");
    return out;
  }

  out.push("Field percentiles from the Chrome UX Report (28-day rolling window). **CrUX publishes p75 only** — p50/p90 marked `approx` are interpolated from the three-bin histogram, and p95/p99 are not derivable from it.");
  out.push("");

  for (const { route } of meta.routes) {
    for (const device of DEVICES) {
      const field = fieldFor(ctx, route, device);
      if (!field) continue;
      out.push(`**\`${route}\` — ${device}** · ${sourceLabel(field)}`);
      out.push("");
      out.push("| Metric | p50 | p75 | p95 | Target | Status |");
      out.push("|---|---:|---:|---:|---:|---|");
      for (const metric of ["lcp", "inp", "cls", "fcp", "ttfb"]) {
        const m = field.metrics?.[metric];
        if (!m) continue;
        const t = THRESHOLDS[metric];
        const p50 = m.p50 == null ? "not available" : `${fmt(metric, m.p50)} _approx_`;
        const p75 = m.p75 == null ? "not measured" : fmt(metric, m.p75);
        const status = m.p75 == null ? "Not measured" : statusWord(rate(metric, m.p75));
        out.push(`| ${t.label} | ${p50} | **${p75}** | not available | ≤ ${fmt(metric, t.good)} | ${status} |`);
      }
      out.push("");
      const lcpDist = field.metrics?.lcp?.distribution;
      if (lcpDist) {
        out.push(`_LCP distribution: ${Math.round(lcpDist.good * 100)}% good · ${Math.round(lcpDist.needsImprovement * 100)}% needs improvement · ${Math.round(lcpDist.poor * 100)}% poor._`);
        out.push("");
      }
    }
  }

  out.push("**Segments not covered by CrUX** — browser (Chrome only), logged-in vs guest, country, deployment ID, new vs returning, and any authenticated or low-traffic route. Those require first-party RUM.");
  out.push("");
  return out;
}

function verdict({ score, counts, priorities, meta, findings }) {
  const parts = [];
  const head = !meta.hasField
    ? "No field data was available, so this audit reports lab measurements only — treat every Core Web Vitals verdict as provisional."
    : score >= 90
      ? "Real-user performance is healthy across the routes measured."
      : score >= 60
        ? "Real-user performance is workable but has clear, measurable gaps."
        : "Real-user performance is failing on the routes measured.";
  if (priorities.P0) parts.push(`${priorities.P0} P0 issue(s) affecting customers now`);
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.high) parts.push(`${counts.high} high-severity`);

  const mobile = findings.filter((f) => f.status === "fail" && f.devices === "mobile").length;
  const desktop = findings.filter((f) => f.status === "fail" && f.devices === "desktop").length;
  const deviceLine = mobile || desktop
    ? ` Mobile carries ${mobile} substantiated finding(s) against ${desktop} on desktop — mobile is the target that matters.`
    : "";

  const notMeasured = counts.info ? ` ${counts.info} item(s) could not be measured and are reported as Info, not as passes.` : "";
  const tail = parts.length ? ` Priorities: ${parts.join("; ")}.` : " No critical or high-severity defects were substantiated.";
  return `${head}${tail}${deviceLine}${notMeasured} Work the Prioritization table top-down; the phased tasks are in \`PERFORMANCE_PLAN.md\`.`;
}

function statusWord(r) {
  if (r === "good") return "✅ Good";
  if (r === "needs-improvement") return "⚠️ Needs improvement";
  if (r === "poor") return "❌ Poor";
  return "Not measured";
}

function sourceName(source) {
  return {
    crux: "CrUX field data",
    psi: "PSI field data (CrUX-backed)",
    "psi-lab": "Lighthouse lab run (PSI)",
    headers: "direct HTTP response",
    static: "static source analysis",
    mcp: "chrome-devtools MCP capture",
  }[source] || source;
}

function fence(lang, body) {
  const safe = String(body).replace(/```/g, "ʼʼʼ");
  return "```" + (lang || "") + "\n" + safe + "\n```";
}

function escapePipes(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}
