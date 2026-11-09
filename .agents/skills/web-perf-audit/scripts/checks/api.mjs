// API performance: per-endpoint latency, payload size, duplicate and sequential
// calls. Sources are the lab waterfall (XHR/fetch entries) and any network log
// captured through the chrome-devtools MCP server.
//
// Deliberately conservative: a lab run sees one sample per endpoint, so latency
// findings say "single lab sample" and never claim a p95. Real percentiles need
// server-side APM or first-party RUM — that gap is reported, not invented.

import { finding } from "../lib/findings.mjs";
import { bytes as fmtBytes } from "../lib/thresholds.mjs";
import { labFor, auditItems } from "../lib/measure.mjs";

const DEVICES = ["mobile", "desktop"];
const API_TYPES = new Set(["XHR", "Fetch", "xhr", "fetch"]);

export function run(ctx) {
  const out = [];
  for (const { route } of ctx.routes) {
    const requests = collectRequests(ctx, route);
    if (!requests.length) continue;
    out.push(...slowEndpoints(requests, route));
    out.push(...duplicateCalls(requests, route));
    out.push(...largePayloads(requests, route));
    out.push(...nPlusOne(requests, route));
  }
  if (!ctx.mcp?.network?.length) {
    out.push(
      finding({
        id: "API-PERCENTILES-UNAVAILABLE",
        title: "API latency percentiles were not measured",
        severity: "info",
        category: "api",
        status: "info",
        metric: "endpoint p75 / p95 / p99",
        currentValue: "not measured",
        targetValue: "p95 per critical endpoint",
        evidence: "Only single-sample lab timings were available. One synthetic request cannot produce a percentile.",
        recommendation:
          "Read p95/p99 per endpoint from server-side APM or first-party RUM (see references/NETWORK_API.md). Treat the latencies in this report as one lab sample each.",
        source: "psi-lab",
      }),
    );
  }
  return dedupe(out);
}

/** Normalize API requests from the lab waterfall and the MCP network log. */
function collectRequests(ctx, route) {
  const requests = [];
  for (const device of DEVICES) {
    const lighthouse = labFor(ctx, route, device);
    for (const item of auditItems(lighthouse, "network-requests")) {
      const type = String(item.resourceType || "");
      if (!API_TYPES.has(type)) continue;
      requests.push({
        url: String(item.url || ""),
        method: item.method || "GET",
        status: item.statusCode ?? null,
        duration: durationOf(item),
        size: Number(item.transferSize) || Number(item.resourceSize) || 0,
        device,
        source: "psi-lab",
      });
    }
  }
  for (const item of ctx.mcp?.network || []) {
    const type = String(item.resourceType || item.type || "");
    const url = String(item.url || "");
    if (!API_TYPES.has(type) && !/\/api\/|\/graphql/i.test(url)) continue;
    requests.push({
      url,
      method: item.method || "GET",
      status: item.status ?? item.statusCode ?? null,
      duration: Number(item.durationMs ?? item.duration) || null,
      size: Number(item.size ?? item.transferSize) || 0,
      device: item.device || "mcp",
      source: "mcp",
    });
  }
  return requests.filter((r) => r.url);
}

function durationOf(item) {
  const start = Number(item.networkRequestTime ?? item.startTime);
  const end = Number(item.networkEndTime ?? item.endTime);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return Math.round(end - start);
  return null;
}

function slowEndpoints(requests, route) {
  const out = [];
  const seen = new Set();
  for (const r of requests) {
    if (r.duration == null || r.duration <= 500) continue;
    const key = endpointKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding({
        id: r.duration > 1000 ? "API-VERY-SLOW" : "API-SLOW",
        title: `${r.method} ${key} took ${r.duration}ms on \`${route}\``,
        severity: r.duration > 1000 ? "high" : "medium",
        category: "api",
        scope: "page",
        route,
        devices: r.device === "mcp" ? "all" : r.device,
        metric: "single lab/MCP sample of request duration",
        currentValue: `${r.duration}ms`,
        targetValue: "< 500ms",
        evidence: `${r.method} ${r.url}\nstatus ${r.status ?? "?"} · ${r.duration}ms · ${fmtBytes(r.size)} (${r.source}, one sample)`,
        rootCause: "Not derivable from the client side. Trace this endpoint server-side before optimizing the front end around it.",
        userImpact: "Content that depends on this call appears late, or the interaction that triggers it feels unresponsive.",
        businessImpact: "Blocking API latency shows up directly in LCP when the call feeds above-the-fold content.",
        recommendation:
          "Trace the endpoint server-side (query plan, N+1, external calls) and fix the source. Only then decide whether the response should also be cached or moved to the server render.",
        expectedImprovement: "Removing blocking API latency moves the dependent content earlier by roughly the same amount.",
        effort: "high",
        frequency: 3,
        exposure: 3,
        confidence: 0.6,
        source: r.source,
      }),
    );
  }
  return out;
}

function duplicateCalls(requests, route) {
  const groups = new Map();
  for (const r of requests) {
    if (r.device === "desktop") continue; // count once, from the mobile pass
    const key = `${r.method} ${r.url}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const dupes = [...groups.entries()].filter(([, n]) => n > 1);
  if (!dupes.length) return [];

  return [
    finding({
      id: "API-DUPLICATE-REQUESTS",
      title: `${dupes.length} endpoint(s) requested more than once on \`${route}\``,
      severity: "medium",
      category: "api",
      scope: "page",
      route,
      metric: "repeated identical requests in one page load",
      currentValue: `${dupes.reduce((n, [, c]) => n + c, 0)} requests across ${dupes.length} endpoint(s)`,
      targetValue: "one request per resource per load",
      evidence: dupes.slice(0, 5).map(([key, n]) => `${n}× ${key}`).join("\n"),
      rootCause: "Several components fetch the same data independently, or an effect re-runs on an unstable dependency.",
      userImpact: "Extra latency and data for a response the page already had.",
      businessImpact: "Multiplies backend load for no user benefit.",
      recommendation: "Fetch once and share: hoist the fetch to the server component or route loader, or de-duplicate through a request cache.",
      expectedImprovement: "One round trip and one payload removed per duplicate.",
      effort: "low",
      fixSnippet: `// React: dedupe an identical fetch within a render pass
import { cache } from 'react';
export const getUser = cache(async (id) => (await fetch(\`/api/users/\${id}\`)).json());`,
      fixLang: "js",
      frequency: 4,
      exposure: 4,
      confidence: 0.85,
      source: "psi-lab",
    }),
  ];
}

function largePayloads(requests, route) {
  const out = [];
  const seen = new Set();
  for (const r of requests) {
    if (r.size <= 250 * 1024) continue;
    const key = endpointKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding({
        id: "API-LARGE-PAYLOAD",
        title: `${key} returns ${fmtBytes(r.size)} on \`${route}\``,
        severity: r.size > 1024 * 1024 ? "high" : "medium",
        category: "api",
        scope: "page",
        route,
        metric: "API response transfer size",
        currentValue: fmtBytes(r.size),
        targetValue: "< 250 KB per response",
        evidence: `${r.method} ${r.url} → ${fmtBytes(r.size)}${r.duration ? ` in ${r.duration}ms` : ""} (${r.source}).`,
        rootCause: "The endpoint returns more rows or more fields than the view renders.",
        userImpact: "Download and JSON parse both block the main thread before the UI can use the data.",
        businessImpact: "Large payloads hurt worst on mobile, where parse cost is highest.",
        recommendation: "Paginate, and return only the fields this view renders. Check for compression on the response too.",
        expectedImprovement: "Payload reductions translate almost linearly into earlier render of dependent content.",
        effort: "medium",
        fixSnippet: `GET /api/products?fields=id,name,price,thumbnail&limit=24&cursor=<next>`,
        fixLang: "http",
        frequency: 3,
        exposure: 4,
        confidence: 0.8,
        source: r.source,
      }),
    );
  }
  return out;
}

function nPlusOne(requests, route) {
  const patterns = new Map();
  for (const r of requests) {
    if (r.device === "desktop") continue;
    const pattern = endpointKey(r.url).replace(/\/\d+(?=\/|$)/g, "/:id").replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/:id");
    patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
  }
  const hits = [...patterns.entries()].filter(([, n]) => n >= 5);
  if (!hits.length) return [];

  return hits.map(([pattern, count]) =>
    finding({
      id: "API-N-PLUS-ONE",
      title: `${count} requests to \`${pattern}\` in one load of \`${route}\``,
      severity: count >= 10 ? "high" : "medium",
      category: "api",
      scope: "page",
      route,
      metric: "requests per endpoint pattern per page load",
      currentValue: `${count} requests`,
      targetValue: "one batched request",
      evidence: `The pattern \`${pattern}\` was requested ${count} times during a single page load.`,
      rootCause: "The client loops over a collection and fetches each item separately — an N+1 moved to the front end.",
      userImpact: "N round trips instead of one, serialized behind connection limits on mobile.",
      businessImpact: "Multiplies backend and edge load per visitor.",
      recommendation: "Add a batch endpoint (or include the related data in the parent response) and fetch once.",
      expectedImprovement: `${count} requests collapse to 1.`,
      effort: "medium",
      fixSnippet: `# Before: N requests
GET /api/products/1  … GET /api/products/N

# After: one batched request
GET /api/products?ids=1,2,3,4,5`,
      fixLang: "http",
      frequency: 3,
      exposure: 4,
      confidence: 0.75,
      source: "psi-lab",
    }),
  );
}

function endpointKey(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url).split("?")[0];
  }
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.id}|${f.route}|${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
