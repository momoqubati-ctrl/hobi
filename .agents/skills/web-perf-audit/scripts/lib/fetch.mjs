// Redirect-aware fetch + JSON helpers on native fetch (Node 18+). No deps.
//
// Used for two jobs:
//   1. document/API probes — record the redirect chain, status, headers and a
//      wall-clock TTFB so caching/compression/latency checks have real evidence
//   2. talking to the CrUX and PageSpeed Insights APIs

const UA =
  "Mozilla/5.0 (compatible; web-perf-audit/1.0; +https://github.com/ezzatmakar/ai-code-skills)";

/**
 * Fetch following redirects manually so every hop is recorded.
 * Returns { url, finalUrl, status, ok, headers, body, redirects[], ttfbMs, totalMs, bytes, error }.
 */
export async function fetchPage(url, { timeoutMs = 20000, maxHops = 10, method = "GET", userAgent = UA, headers = {} } = {}) {
  const redirects = [];
  let current = url;
  const started = Date.now();
  let firstByteAt = null;

  for (let hop = 0; hop <= maxHops; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,*/*", ...headers },
      });
    } catch (err) {
      clearTimeout(timer);
      return errorResult(url, current, redirects, started, err);
    }
    clearTimeout(timer);
    if (firstByteAt === null) firstByteAt = Date.now();

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const location = new URL(res.headers.get("location"), current).toString();
      redirects.push({ from: current, to: location, status: res.status });
      current = location;
      continue;
    }

    let body = "";
    try {
      body = method === "HEAD" ? "" : await res.text();
    } catch {
      body = "";
    }
    return {
      url,
      finalUrl: current,
      status: res.status,
      ok: res.ok,
      headers: headersToObject(res.headers),
      body,
      redirects,
      ttfbMs: firstByteAt - started,
      totalMs: Date.now() - started,
      bytes: Buffer.byteLength(body, "utf8"),
      error: null,
    };
  }

  return {
    ...errorResult(url, current, redirects, started, new Error(`too many redirects (>${maxHops})`)),
    status: 310,
  };
}

/** GET JSON. Returns { ok, status, json, error }. Never throws. */
export async function getJson(url, { timeoutMs = 60000, headers = {} } = {}) {
  return requestJson(url, { method: "GET", timeoutMs, headers });
}

/** POST JSON. Returns { ok, status, json, error }. Never throws. */
export async function postJson(url, body, { timeoutMs = 60000, headers = {} } = {}) {
  return requestJson(url, {
    method: "POST",
    timeoutMs,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function requestJson(url, { method, timeoutMs, headers, body }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "user-agent": UA, accept: "application/json", ...headers },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      error: res.ok ? null : json?.error?.message || `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, status: 0, json: null, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Measure TTFB over N sequential samples. Deliberately sequential and capped — this is a probe, not a load test. */
export async function sampleTtfb(url, samples = 3, opts = {}) {
  const capped = Math.max(1, Math.min(5, samples));
  const values = [];
  let last = null;
  for (let i = 0; i < capped; i++) {
    const r = await fetchPage(url, opts);
    last = r;
    if (r.ttfbMs != null && !r.error) values.push(r.ttfbMs);
  }
  return { values, last };
}

/** Slug a URL/route into a filesystem-safe name. */
export function slugifyUrl(u) {
  try {
    const { pathname } = new URL(u);
    const p = pathname.replace(/\/+$/, "") || "/";
    return p === "/" ? "home" : p.replace(/^\/+/, "").replace(/[^a-z0-9._-]+/gi, "-");
  } catch {
    return String(u).replace(/[^a-z0-9._-]+/gi, "-") || "page";
  }
}

/** Route ("/pricing") for a URL, "/" for the origin root. */
export function routeOf(u) {
  try {
    const { pathname } = new URL(u);
    return pathname === "" ? "/" : pathname;
  } catch {
    return String(u);
  }
}

function errorResult(url, current, redirects, started, err) {
  return {
    url,
    finalUrl: current,
    status: 0,
    ok: false,
    headers: {},
    body: "",
    redirects,
    ttfbMs: null,
    totalMs: Date.now() - started,
    bytes: 0,
    error: String(err?.message || err),
  };
}

function headersToObject(h) {
  const out = {};
  for (const [k, v] of h.entries()) out[k.toLowerCase()] = v;
  return out;
}
