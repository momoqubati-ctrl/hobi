// Lookup helpers that resolve "what did we actually measure for this route?"
//
// Every check asks these instead of digging through field.json / lab.json, so a
// value's provenance (CrUX url record vs CrUX origin vs PSI field vs lab) is
// recorded once and reported honestly everywhere.

export const FORM_FACTOR = { mobile: "PHONE", desktop: "DESKTOP" };
export const STRATEGY = { PHONE: "mobile", DESKTOP: "desktop" };

/**
 * Best available field data for a route + device.
 * Returns { metrics, source, scope, collectionPeriod } or null when nothing was measured.
 * Preference: CrUX url record → PSI page field → CrUX origin record → PSI origin field.
 */
export function fieldFor(ctx, route, device = "mobile") {
  const formFactor = FORM_FACTOR[device] || "PHONE";
  const crux = ctx.field?.records || [];

  const urlRec = crux.find((r) => r.status === "ok" && r.scope === "url" && r.route === route && r.formFactor === formFactor);
  if (urlRec) return { metrics: urlRec.record.metrics, source: "crux", scope: "url", collectionPeriod: urlRec.record.collectionPeriod };

  const psiRun = (ctx.lab?.runs || []).find((r) => r.status === "ok" && r.strategy === STRATEGY[formFactor] && routeOfRun(ctx, r) === route);
  if (psiRun?.field?.metrics && Object.keys(psiRun.field.metrics).length) {
    return { metrics: psiRun.field.metrics, source: "psi", scope: "url", collectionPeriod: null };
  }

  const originRec = crux.find((r) => r.status === "ok" && r.scope === "origin" && r.formFactor === formFactor);
  if (originRec) return { metrics: originRec.record.metrics, source: "crux", scope: "origin", collectionPeriod: originRec.record.collectionPeriod };

  if (psiRun?.originField?.metrics && Object.keys(psiRun.originField.metrics).length) {
    return { metrics: psiRun.originField.metrics, source: "psi", scope: "origin", collectionPeriod: null };
  }
  return null;
}

/** True when at least one field measurement exists anywhere in the run. */
export function hasField(ctx) {
  for (const route of ctx.routes.map((r) => r.route)) {
    for (const device of ["mobile", "desktop"]) {
      if (fieldFor(ctx, route, device)) return true;
    }
  }
  return false;
}

/** Lab (Lighthouse) result for a route + strategy, or null. */
export function labFor(ctx, route, strategy = "mobile") {
  const run = (ctx.lab?.runs || []).find((r) => r.status === "ok" && r.strategy === strategy && routeOfRun(ctx, r) === route);
  return run?.lighthouse || null;
}

/** Every successful lab run, newest-first order preserved. */
export function labRuns(ctx) {
  return (ctx.lab?.runs || []).filter((r) => r.status === "ok" && r.lighthouse);
}

/** One normalized Lighthouse audit, or null when the run did not include it. */
export function audit(lighthouse, id) {
  return lighthouse?.audits?.[id] || null;
}

/** An audit's items, always an array. */
export function auditItems(lighthouse, id) {
  return audit(lighthouse, id)?.items || [];
}

/** Sum a numeric field across audit items. */
export function sumBy(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

/** The route a PSI run belongs to. */
export function routeOfRun(ctx, run) {
  try {
    const path = new URL(run.url).pathname || "/";
    const match = ctx.routes.find((r) => r.route === path);
    return match ? match.route : path;
  } catch {
    return "/";
  }
}

/** Response headers recorded for a route, or null. */
export function headersFor(ctx, route) {
  return ctx.headers?.[route] || null;
}

/** Human label for a provenance pair, e.g. "CrUX field (url)". */
export function sourceLabel(field) {
  if (!field) return "not measured";
  const name = field.source === "crux" ? "CrUX field" : "PSI field (CrUX-backed)";
  return `${name} (${field.scope}-level)`;
}
