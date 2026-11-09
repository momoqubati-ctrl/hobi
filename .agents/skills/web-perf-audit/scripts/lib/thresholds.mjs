// Google's Core Web Vitals cut-offs and the derived severity mapping.
// Single source of truth: checks, budgets, compare and the report all read these.
// See references/CORE_WEB_VITALS.md for the citations.

/** metric key → { label, unit, good, poor, higherIsWorse } */
export const THRESHOLDS = {
  lcp: { label: "LCP", unit: "ms", good: 2500, poor: 4000 },
  inp: { label: "INP", unit: "ms", good: 200, poor: 500 },
  cls: { label: "CLS", unit: "", good: 0.1, poor: 0.25 },
  fcp: { label: "FCP", unit: "ms", good: 1800, poor: 3000 },
  ttfb: { label: "TTFB", unit: "ms", good: 800, poor: 1800 },
};

/** The three metrics Google counts as Core Web Vitals. */
export const CORE = ["lcp", "inp", "cls"];

/** CrUX histogram bin edges per metric (bins are [start, end)). */
export const BINS = {
  lcp: [0, 2500, 4000],
  inp: [0, 200, 500],
  cls: [0, 0.1, 0.25],
  fcp: [0, 1800, 3000],
  ttfb: [0, 800, 1800],
};

/** "good" | "needs-improvement" | "poor" | null when the value is unknown. */
export function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (!t || value == null || Number.isNaN(value)) return null;
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

/** Severity for a measured metric: poor → high, needs-improvement → medium. */
export function severityFor(metric, value) {
  const r = rate(metric, value);
  if (r === "poor") return "high";
  if (r === "needs-improvement") return "medium";
  return null; // good, or not measured
}

/** Format a metric value for a report cell. */
export function fmt(metric, value) {
  if (value == null || Number.isNaN(value)) return "—";
  const t = THRESHOLDS[metric];
  if (!t) return String(value);
  if (metric === "cls") return Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${Math.round(value)}${t.unit}`;
}

/** Format bytes as KB/MB for report cells. */
export function bytes(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
