// Finding shape, deterministic IDs, severity, priority and scoring.
//
// Every check module returns findings built with finding(). Findings are
// deterministic: the same measurements always produce the same id, severity,
// priority and score, so two runs diff cleanly and a regression is real.
//
// Rules encoded here (see references/SEVERITY_RUBRIC.md):
//   - only `fail` findings reduce the score; `info` (not measured) never does
//   - priority = impact x frequency x exposure x confidence, computed, not guessed
//   - a finding with no measured value cannot be a `fail`

/** Ordered most→least severe. `info` means "could not measure / context only". */
export const SEVERITIES = ["critical", "high", "medium", "low", "info"];

/** Score penalty per failing finding. */
export const PENALTY = { critical: 20, high: 10, medium: 4, low: 1, info: 0 };

export const BADGE = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "🔵 Low",
  info: "⚪ Info",
};

export const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };

/** Scorecard areas, in report order. Every finding belongs to exactly one. */
export const CATEGORIES = [
  "lcp",
  "inp",
  "cls",
  "ttfb",
  "javascript",
  "api",
  "images",
  "fonts",
  "caching",
  "thirdparty",
  "runtime",
  "rum",
];

export const CATEGORY_LABEL = {
  lcp: "LCP",
  inp: "INP",
  cls: "CLS",
  ttfb: "TTFB",
  javascript: "JavaScript",
  api: "APIs",
  images: "Images",
  fonts: "Fonts",
  caching: "Caching",
  thirdparty: "Third Party",
  runtime: "Runtime",
  rum: "RUM Coverage",
};

const IMPACT = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/**
 * Deterministic P0–P3 from the audit's four factors.
 *   frequency  1–4  how often the affected code path runs (every load = 4)
 *   exposure   1–4  share of real users hit (all devices = 4, edge case = 1)
 *   confidence 0–1  how sure we are of the diagnosis AND the fix
 * Returns "P0".."P3", or null for informational findings.
 */
export function computePriority({ severity, frequency = 3, exposure = 3, confidence = 0.75, status = "fail" }) {
  if (status !== "fail") return null;
  const impact = IMPACT[severity] ?? 0;
  if (!impact) return null;
  const score = impact * clamp(frequency, 1, 4) * clamp(exposure, 1, 4) * clamp(confidence, 0, 1);
  let priority = score >= 36 ? "P0" : score >= 18 ? "P1" : score >= 8 ? "P2" : "P3";
  // A critical defect is never below P1 no matter how narrow its exposure.
  if (severity === "critical" && priority !== "P0") priority = "P1";
  return priority;
}

/**
 * Build one finding.
 *
 * status: "fail" (a substantiated defect — penalises the score)
 *       | "info" (not measured / context — never penalises)
 *       | "pass" (verified good — never penalises)
 */
export function finding({
  id,
  title,
  severity,
  category,
  status = "fail",
  scope = "site",          // "site" | "page"
  route = null,            // affected route for page-scoped findings
  devices = "all",         // "mobile" | "desktop" | "all"
  metric = "",             // what was observed, e.g. "LCP p75 (phone, field)"
  currentValue = "",
  targetValue = "",
  evidence = "",
  rootCause = "",
  userImpact = "",
  businessImpact = "",
  recommendation = "",
  expectedImprovement = "",
  effort = "medium",       // "low" | "medium" | "high"
  fixSnippet = "",
  fixLang = "",
  frequency = 3,
  exposure = 3,
  confidence = 0.75,
  source = "",             // "crux" | "psi-lab" | "headers" | "static" | "mcp"
}) {
  if (!SEVERITIES.includes(severity)) throw new Error(`finding ${id}: invalid severity "${severity}"`);
  if (!["fail", "info", "pass"].includes(status)) throw new Error(`finding ${id}: invalid status "${status}"`);
  if (!CATEGORIES.includes(category)) throw new Error(`finding ${id}: unknown category "${category}"`);
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`finding ${id}: invalid effort "${effort}"`);
  if (status === "fail" && severity === "info") {
    throw new Error(`finding ${id}: an info-severity finding cannot have status "fail"`);
  }
  if (status === "fail" && !String(evidence).trim()) {
    throw new Error(`finding ${id}: a fail finding must carry evidence`);
  }
  return {
    id,
    title,
    severity,
    category,
    status,
    scope,
    route,
    devices,
    metric,
    currentValue: String(currentValue),
    targetValue: String(targetValue),
    evidence: String(evidence).trim(),
    rootCause: String(rootCause).trim(),
    userImpact: String(userImpact).trim(),
    businessImpact: String(businessImpact).trim(),
    recommendation: String(recommendation).trim(),
    expectedImprovement: String(expectedImprovement).trim(),
    effort,
    fixSnippet: String(fixSnippet).trim(),
    fixLang,
    source,
    priority: computePriority({ severity, frequency, exposure, confidence, status }),
  };
}

/** Count non-passing findings by severity. */
export function countBySeverity(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.status === "pass") continue;
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return counts;
}

/** Count findings by priority bucket (fails only). */
export function countByPriority(findings) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) if (f.priority) counts[f.priority] += 1;
  return counts;
}

/** Deterministic 0–100 performance score. Only `fail` findings penalise. */
export function performanceScore(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.status !== "fail") continue;
    score -= PENALTY[f.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function band(score) {
  if (score >= 90) return "A — Excellent";
  if (score >= 75) return "B — Good";
  if (score >= 60) return "C — Needs work";
  if (score >= 40) return "D — Poor";
  return "F — Critical";
}

/**
 * Scorecard row per category: worst severity seen, or "Not measured" when the
 * only findings are informational, or "Good" when nothing failed.
 */
export function scorecard(findings) {
  return CATEGORIES.map((category) => {
    const mine = findings.filter((f) => f.category === category);
    const fails = mine.filter((f) => f.status === "fail");
    if (!mine.length) return { category, status: "Not measured", severity: "info", count: 0 };
    if (!fails.length) {
      const onlyInfo = mine.every((f) => f.status === "info");
      return {
        category,
        status: onlyInfo ? "Not measured" : "Good",
        severity: "info",
        count: 0,
      };
    }
    const worst = SEVERITIES.find((s) => fails.some((f) => f.severity === s));
    return {
      category,
      status: worst === "critical" || worst === "high" ? "Poor" : "Needs improvement",
      severity: worst,
      count: fails.length,
    };
  });
}

/** Sort most→least severe, then by priority, then stably by id. */
export function bySeverity(a, b) {
  const d = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
  if (d !== 0) return d;
  const pa = a.priority || "P9";
  const pb = b.priority || "P9";
  if (pa !== pb) return pa.localeCompare(pb);
  return a.id.localeCompare(b.id);
}

/** Sort by priority first (P0 → P3), used by the prioritization table and the plan. */
export function byPriority(a, b) {
  const pa = a.priority || "P9";
  const pb = b.priority || "P9";
  if (pa !== pb) return pa.localeCompare(pb);
  return bySeverity(a, b);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}
