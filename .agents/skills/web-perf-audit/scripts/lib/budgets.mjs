// Performance budgets: the defaults, and the checker both run.mjs and
// budgets.mjs share.
//
// Budgets are targets to adapt, not laws. The defaults below are Google's Core
// Web Vitals "good" thresholds plus widely used asset ceilings; a project with a
// different architecture should override them in its own budgets.json.

export const DEFAULT_BUDGETS = {
  cwv: { lcpMs: 2500, inpMs: 200, cls: 0.1, fcpMs: 1800, ttfbMs: 800 },
  javascript: { initialKb: 200, routeKb: 300 },
  network: { totalKb: 1600 },
  images: { heroKb: 250, totalKb: 800 },
  fonts: { totalKb: 150 },
  api: { p95Ms: 500 },
  thirdParty: { blockingMs: 150 },
};

/** Merge a user budget file over the defaults, one level deep. */
export function mergeBudgets(custom) {
  const out = structuredClone(DEFAULT_BUDGETS);
  for (const [group, values] of Object.entries(custom || {})) {
    if (!values || typeof values !== "object") continue;
    out[group] = { ...(out[group] || {}), ...values };
  }
  return out;
}

const CWV_KEYS = [
  ["lcp", "lcpMs", "LCP p75", "ms"],
  ["inp", "inpMs", "INP p75", "ms"],
  ["cls", "cls", "CLS p75", ""],
  ["fcp", "fcpMs", "FCP p75", "ms"],
  ["ttfb", "ttfbMs", "TTFB p75", "ms"],
];

/**
 * Check a snapshot against budgets.
 * Returns { rows: [{ label, scope, budget, measured, unit, status, source }], breached, checked }.
 * status: "pass" | "fail" | "not-measured" — a missing measurement never counts as a pass.
 */
export function checkBudgets(snapshot, budgets) {
  const rows = [];
  const field = snapshot?.metrics?.field || {};
  const lab = snapshot?.metrics?.lab || {};

  for (const [route, devices] of Object.entries(field)) {
    for (const [device, metrics] of Object.entries(devices || {})) {
      for (const [key, budgetKey, label, unit] of CWV_KEYS) {
        const measured = metrics?.[key];
        const budget = budgets.cwv?.[budgetKey];
        if (budget == null) continue;
        rows.push({
          label,
          scope: `${route} · ${device} · field`,
          budget,
          measured: measured ?? null,
          unit,
          status: measured == null ? "not-measured" : measured <= budget ? "pass" : "fail",
          source: "field",
        });
      }
    }
  }

  for (const [route, devices] of Object.entries(lab)) {
    for (const [device, metrics] of Object.entries(devices || {})) {
      pushBytes(rows, "Route JavaScript", `${route} · ${device} · lab`, metrics?.scriptBytes, budgets.javascript?.routeKb);
      pushBytes(rows, "Total page weight", `${route} · ${device} · lab`, metrics?.totalBytes, budgets.network?.totalKb);
      pushBytes(rows, "Image bytes", `${route} · ${device} · lab`, metrics?.imageBytes, budgets.images?.totalKb);
      pushBytes(rows, "Font bytes", `${route} · ${device} · lab`, metrics?.fontBytes, budgets.fonts?.totalKb);
      if (budgets.thirdParty?.blockingMs != null) {
        const measured = metrics?.thirdPartyBlockingMs;
        rows.push({
          label: "Third-party blocking",
          scope: `${route} · ${device} · lab`,
          budget: budgets.thirdParty.blockingMs,
          measured: measured ?? null,
          unit: "ms",
          status: measured == null ? "not-measured" : measured <= budgets.thirdParty.blockingMs ? "pass" : "fail",
          source: "lab",
        });
      }
    }
  }

  const breached = rows.filter((r) => r.status === "fail");
  return { rows, breached, checked: rows.length };
}

function pushBytes(rows, label, scope, measuredBytes, budgetKb) {
  if (budgetKb == null) return;
  const measured = measuredBytes == null ? null : Math.round(measuredBytes / 1024);
  rows.push({
    label,
    scope,
    budget: budgetKb,
    measured,
    unit: "KB",
    status: measured == null ? "not-measured" : measured <= budgetKb ? "pass" : "fail",
    source: "lab",
  });
}
