# Diagnostics playbook — chrome-devtools MCP

Lighthouse measures a page **load**. INP, route transitions, animation cost and
memory leaks all live after it. That gap is filled with a trace, and the
chrome-devtools MCP server is the preferred way to capture one — no install, and
it drives a real browser.

Write every capture as JSON into `<work>/mcp/` and pass `--mcp <dir>` to
`scripts/run.mjs`. Files are merged by key; arrays concatenate.

## Capture order

### 1. Load trace with a realistic device profile

```
emulate                 → CPU throttling 4x, network "Slow 4G"
navigate_page           → the route under test
performance_start_trace → reload: true, autoStop: true
performance_stop_trace
performance_analyze_insight → per-insight detail (LCP breakdown, render blocking, …)
```

The default desktop profile is the single most common reason a lab run looks fine
while the field fails. **Always throttle.**

### 2. Interaction trace — the only way to see INP

```
performance_start_trace  (reload: false)
click / fill / type …    → exercise the real interaction (add to cart, open filter, submit)
performance_stop_trace
```

Read from the trace: the interaction's total latency, its three phases, the
scripts inside the responsible Long Animation Frames.

Write `<work>/mcp/inp.json`:

```json
{ "inp": { "value": 340, "target": "button#add-to-cart", "route": "/products/[slug]",
           "phases": { "inputDelay": 40, "processingDuration": 250, "presentationDelay": 50 } } }
```

### 3. Network waterfall and API timing

```
list_network_requests  → filter to XHR/Fetch
get_network_request    → headers and timing for a specific call
```

Write `<work>/mcp/network.json` as an array of
`{ url, method, resourceType, status, durationMs, size }`. The API checks read it
directly and will find duplicates, N+1 patterns and oversized payloads.

### 4. Route transitions (SPA soft navigations)

Start a trace, navigate client-side (click the link, don't reload), stop it.

```json
{ "routeTransitions": [{ "from": "/", "to": "/products", "durationMs": 1800,
                         "note": "chunk + data fetched after navigation started" }] }
```

### 5. Long tasks

```json
{ "longTasks": [{ "duration": 420, "name": "gallery-init", "route": "/",
                  "attribution": "https://example.com/_next/static/chunks/gallery.js" }] }
```

### 6. Memory

```
take_heapsnapshot   → baseline
(navigate away and back 5×)
take_heapsnapshot   → compare
```

```json
{ "memory": { "growthBytes": 18000000, "note": "5 navigations, heap never returned to baseline" } }
```

A heap that does not return to baseline after navigating away and back is a leak —
usually listeners, timers or subscriptions not cleaned up on unmount.

### 7. Console and errors

`list_console_messages` — JS errors and failed requests degrade real sessions in
ways no metric shows. Filter with a pattern rather than dumping everything.

## Rules

- **Throttle before you conclude anything.** 4× CPU + Slow 4G is the floor for mobile.
- Run each capture at least twice; traces are noisy. Report the median, and say how many runs.
- Exercise the interaction users actually perform, not a synthetic click on `body`.
- Never paste a whole trace into the report. Extract the number and the responsible script.
- If no capture was taken, the runtime section stays `Info — not measured`. Do not infer INP from TBT and present it as measured.

## Fallbacks

- **No MCP available** → Lighthouse via PSI still covers the load phase; runtime findings are reported as not measured.
- **Local dev server** → `--no-lab` plus an MCP capture works fine; CrUX will have no record for localhost, which is expected and stated.
- **Chrome DevTools by hand** → the Performance panel gives the same data; export the numbers into the same JSON shape.
