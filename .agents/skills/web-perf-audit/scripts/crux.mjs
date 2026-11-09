#!/usr/bin/env node
// Chrome UX Report (CrUX) field data — the audit's primary RUM source.
//
//   node crux.mjs --origin https://example.com [--routes /a,/b] [--crux-key KEY]
//                 [--history] [--out field.json]
//
// What CrUX gives us, and what it does NOT:
//   - gives:  p75 for LCP / INP / CLS / FCP / TTFB, per PHONE and DESKTOP,
//             a good/needs-improvement/poor histogram, and 25 weeks of p75 history
//   - does not give: p50 / p90 / p95 / p99. p50 and p90 are approximated here by
//     interpolating the 3-bin histogram and are always tagged `approximate: true`.
//     p95/p99 fall in the open-ended tail bin and are reported as null — never guessed.
//   - does not cover: low-traffic, staging, intranet or auth-gated URLs. Those come
//     back `no-record`, and the audit must report the field section as "not measured".
//
// Without --crux-key the CrUX API is unavailable; psi.mjs still returns CrUX-backed
// field data through PageSpeed Insights (keyless at low volume).

import { writeFile } from "node:fs/promises";
import { parseArgs, list } from "./lib/args.mjs";
import { postJson } from "./lib/fetch.mjs";
import { approxPercentile, distribution } from "./lib/percentiles.mjs";

const API = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const HISTORY_API = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord";

/** CrUX metric name → the short key used everywhere else in this skill. */
export const METRIC_MAP = {
  largest_contentful_paint: "lcp",
  interaction_to_next_paint: "inp",
  cumulative_layout_shift: "cls",
  first_contentful_paint: "fcp",
  experimental_time_to_first_byte: "ttfb",
  round_trip_time: "rtt",
};

const METRICS = Object.keys(METRIC_MAP);
const FORM_FACTORS = ["PHONE", "DESKTOP"];

/** Normalize one CrUX `record` into { key, collectionPeriod, metrics: {lcp: {...}} }. */
export function normalizeRecord(record) {
  const metrics = {};
  for (const [cruxName, short] of Object.entries(METRIC_MAP)) {
    const m = record?.metrics?.[cruxName];
    if (!m) continue;
    const hist = m.histogram || [];
    const p50 = approxPercentile(hist, 50);
    const p90 = approxPercentile(hist, 90);
    metrics[short] = {
      p75: toNumber(m.percentiles?.p75),
      p50: p50 ? p50.value : null,
      p90: p90 ? p90.value : null,
      p95: null, // open-ended tail bin — not derivable from a 3-bin histogram
      p99: null,
      approximate: { p50: Boolean(p50), p90: Boolean(p90) },
      distribution: distribution(hist),
      histogram: hist,
    };
  }
  return {
    key: record?.key || {},
    collectionPeriod: record?.collectionPeriod || null,
    metrics,
  };
}

/** Query one CrUX record. Returns { status: "ok"|"no-record"|"error", record?, error? }. */
export async function queryRecord({ origin, url, formFactor, key }) {
  const body = { metrics: METRICS };
  if (url) body.url = url;
  else body.origin = origin;
  if (formFactor) body.formFactor = formFactor;

  const res = await postJson(`${API}?key=${encodeURIComponent(key)}`, body);
  if (res.ok && res.json?.record) {
    return { status: "ok", record: normalizeRecord(res.json.record) };
  }
  const message = String(res.error || "").toLowerCase();
  if (res.status === 404 || message.includes("not found")) {
    return { status: "no-record", error: "CrUX has no data for this target (insufficient traffic, or not publicly reachable)." };
  }
  return { status: "error", error: res.error || `HTTP ${res.status}` };
}

/** 25-week p75 history for one target. Used for the trend + regression sections. */
export async function queryHistory({ origin, url, formFactor, key }) {
  const body = { metrics: METRICS };
  if (url) body.url = url;
  else body.origin = origin;
  if (formFactor) body.formFactor = formFactor;

  const res = await postJson(`${HISTORY_API}?key=${encodeURIComponent(key)}`, body);
  if (!res.ok || !res.json?.record) {
    return { status: res.status === 404 ? "no-record" : "error", error: res.error || `HTTP ${res.status}` };
  }
  const rec = res.json.record;
  const periods = (rec.collectionPeriods || []).map((p) => isoDate(p?.lastDate));
  const series = {};
  for (const [cruxName, short] of Object.entries(METRIC_MAP)) {
    const p75s = rec.metrics?.[cruxName]?.percentilesTimeseries?.p75s;
    if (Array.isArray(p75s)) series[short] = p75s.map(toNumber);
  }
  return { status: "ok", periods, series };
}

/** Collect field data for an origin and its routes. */
export async function collectField({ origin, routes = [], key, history = false }) {
  const out = {
    source: "crux",
    origin,
    generated: new Date().toISOString(),
    available: Boolean(key),
    note: key
      ? "CrUX publishes p75 only. p50/p90 are histogram-derived approximations; p95/p99 are not derivable."
      : "No CrUX API key supplied (--crux-key). Field data must come from psi.mjs (PageSpeed Insights) instead.",
    records: [],
    history: null,
  };
  if (!key) return out;

  for (const formFactor of FORM_FACTORS) {
    const r = await queryRecord({ origin, formFactor, key });
    out.records.push({ scope: "origin", target: origin, formFactor, ...r });
  }
  for (const route of routes) {
    const url = absolute(origin, route);
    for (const formFactor of FORM_FACTORS) {
      const r = await queryRecord({ url, formFactor, key });
      out.records.push({ scope: "url", target: url, route, formFactor, ...r });
    }
  }
  if (history) {
    out.history = await queryHistory({ origin, formFactor: "PHONE", key });
  }
  return out;
}

export function absolute(origin, route) {
  try {
    return new URL(route, origin).toString();
  } catch {
    return route;
  }
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(d) {
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const origin = args.origin || args.url;
  if (!origin || origin === true) {
    console.error("Usage: crux.mjs --origin https://example.com [--routes /a,/b] [--crux-key KEY] [--history] [--out field.json]");
    return 2;
  }
  const key = typeof args["crux-key"] === "string" ? args["crux-key"] : process.env.CRUX_API_KEY || "";
  const data = await collectField({
    origin: new URL(origin).origin,
    routes: list(args.routes),
    key,
    history: Boolean(args.history),
  });

  const json = JSON.stringify(data, null, 2);
  if (typeof args.out === "string") {
    await writeFile(args.out, json, "utf8");
    const ok = data.records.filter((r) => r.status === "ok").length;
    console.log(`Wrote ${args.out} — ${ok}/${data.records.length} CrUX records with data.`);
  } else {
    console.log(json);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
