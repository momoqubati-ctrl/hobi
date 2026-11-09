// Runtime behaviour after load: long tasks, INP attribution, route transitions,
// animations and memory.
//
// Almost none of this is visible to a synthetic page-load audit, so this module
// reads what the agent captured through the chrome-devtools MCP server and drops
// into <work>/mcp/*.json. With no capture it reports "not measured" rather than
// guessing — see references/DIAGNOSTICS.md for the capture playbook.

import { finding } from "../lib/findings.mjs";
import { labFor, audit } from "../lib/measure.mjs";

export function run(ctx) {
  const out = [];
  const mcp = ctx.mcp || {};
  const captured = Boolean(mcp.longTasks?.length || mcp.loaf?.length || mcp.inp || mcp.memory || mcp.routeTransitions?.length);

  if (!captured) {
    out.push(
      finding({
        id: "RUNTIME-NOT-MEASURED",
        title: "Post-load runtime behaviour was not measured",
        severity: "info",
        category: "runtime",
        status: "info",
        metric: "long tasks, INP attribution, route transitions, memory",
        currentValue: "not measured",
        targetValue: "a trace per interactive route",
        evidence: "No chrome-devtools MCP capture was supplied for this run (expected in <work>/mcp/).",
        recommendation:
          "Record a trace with `performance_start_trace` / `performance_stop_trace` while exercising the page's main interaction, then re-run the engine. Lighthouse only measures load; INP, route transitions, animation cost and memory leaks live after it.",
        source: "mcp",
      }),
    );
  }

  for (const task of (mcp.longTasks || []).filter((t) => Number(t.duration) > 200).slice(0, 5)) {
    out.push(
      finding({
        id: "RUNTIME-LONG-TASK",
        title: `${Math.round(Number(task.duration))}ms long task${task.route ? ` on \`${task.route}\`` : ""}`,
        severity: Number(task.duration) > 500 ? "high" : "medium",
        category: "inp",
        scope: task.route ? "page" : "site",
        route: task.route || null,
        metric: "long task duration (trace)",
        currentValue: `${Math.round(Number(task.duration))}ms`,
        targetValue: "< 50ms per task",
        evidence: `Long task: ${Math.round(Number(task.duration))}ms${task.name ? ` (${task.name})` : ""}${task.attribution ? `\nAttributed to: ${String(task.attribution).slice(0, 200)}` : ""}`,
        rootCause: "A single uninterrupted task holds the main thread, so no input can be processed or painted until it ends.",
        userImpact: "Taps during this window are queued, then respond late — this is what INP measures.",
        businessImpact: "Long tasks during interaction are the direct cause of a failing INP.",
        recommendation: "Break the task into chunks and yield between them, or move the work to a worker.",
        expectedImprovement: "Input latency drops to roughly the length of the longest remaining chunk.",
        effort: "medium",
        fixSnippet: `// Yield so queued input can be handled between chunks
for (const chunk of chunks) {
  process(chunk);
  await scheduler.yield?.() ?? new Promise((r) => setTimeout(r, 0));
}`,
        fixLang: "js",
        frequency: 3,
        exposure: 4,
        confidence: 0.85,
        source: "mcp",
      }),
    );
  }

  if (mcp.inp?.value != null && Number(mcp.inp.value) > 200) {
    const p = mcp.inp.phases || {};
    out.push(
      finding({
        id: "RUNTIME-INP-ATTRIBUTION",
        title: `Measured interaction took ${Math.round(Number(mcp.inp.value))}ms${mcp.inp.route ? ` on \`${mcp.inp.route}\`` : ""}`,
        severity: Number(mcp.inp.value) > 500 ? "high" : "medium",
        category: "inp",
        scope: mcp.inp.route ? "page" : "site",
        route: mcp.inp.route || null,
        metric: "INP attribution (trace)",
        currentValue: `${Math.round(Number(mcp.inp.value))}ms`,
        targetValue: "≤ 200ms",
        evidence: [
          `Interaction target: ${mcp.inp.target || "unknown"}`,
          `Input delay: ${ms(p.inputDelay)} · Processing: ${ms(p.processingDuration)} · Presentation: ${ms(p.presentationDelay)}`,
        ].join("\n"),
        rootCause: dominantPhase(p),
        userImpact: "The interface does not acknowledge the interaction within the frame budget.",
        businessImpact: "INP failures concentrate on the interactive steps that convert.",
        recommendation: "Fix the dominant phase: input delay → reduce pre-existing main-thread work; processing → split the handler; presentation → shrink the affected render tree.",
        expectedImprovement: "Bringing the dominant phase under ~100ms usually moves INP into the good band.",
        effort: "medium",
        frequency: 3,
        exposure: 4,
        confidence: 0.9,
        source: "mcp",
      }),
    );
  }

  for (const t of (mcp.routeTransitions || []).filter((t) => Number(t.durationMs) > 1000).slice(0, 5)) {
    out.push(
      finding({
        id: "RUNTIME-SLOW-ROUTE-TRANSITION",
        title: `Route transition ${t.from || "?"} → ${t.to || "?"} took ${Math.round(Number(t.durationMs))}ms`,
        severity: Number(t.durationMs) > 2000 ? "high" : "medium",
        category: "runtime",
        scope: "page",
        route: t.to || null,
        metric: "client-side route transition duration (trace)",
        currentValue: `${Math.round(Number(t.durationMs))}ms`,
        targetValue: "< 1000ms",
        evidence: `Soft navigation ${t.from || "?"} → ${t.to || "?"}: ${Math.round(Number(t.durationMs))}ms${t.note ? ` (${t.note})` : ""}.`,
        rootCause: "The destination route fetches its data and its chunk only after navigation starts, serializing download, parse and render.",
        userImpact: "In-app navigation feels slower than a full page load, which users read as the app being broken.",
        businessImpact: "Soft navigations are invisible to page-load monitoring, so this rarely shows up in dashboards.",
        recommendation: "Prefetch the destination chunk and its data on intent (hover/viewport), and render a meaningful boundary immediately.",
        expectedImprovement: "Transition time approaches the data fetch alone.",
        effort: "medium",
        fixSnippet: `import Link from 'next/link';
<Link href="/products" prefetch>Products</Link>   // prefetch chunk + data on viewport/hover`,
        fixLang: "jsx",
        frequency: 3,
        exposure: 4,
        confidence: 0.8,
        source: "mcp",
      }),
    );
  }

  if (mcp.memory?.growthBytes != null && Number(mcp.memory.growthBytes) > 10 * 1024 * 1024) {
    out.push(
      finding({
        id: "RUNTIME-MEMORY-GROWTH",
        title: `JS heap grew ${Math.round(Number(mcp.memory.growthBytes) / (1024 * 1024))} MB across repeated navigations`,
        severity: "medium",
        category: "runtime",
        metric: "heap size delta between snapshots",
        currentValue: `+${Math.round(Number(mcp.memory.growthBytes) / (1024 * 1024))} MB`,
        targetValue: "heap returns to baseline after navigation",
        evidence: `Heap snapshots: ${JSON.stringify(mcp.memory).slice(0, 300)}`,
        rootCause: "Detached DOM nodes, uncleaned listeners, timers or subscriptions retained across route changes.",
        userImpact: "Long sessions get progressively slower and can crash the tab on low-memory phones.",
        businessImpact: "Hits the most engaged users hardest.",
        recommendation: "Compare two heap snapshots, find the retaining path, and clean up listeners/timers in effect teardown.",
        expectedImprovement: "Heap returns to baseline between navigations.",
        effort: "high",
        fixSnippet: `useEffect(() => {
  const onScroll = () => {/* … */};
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
}, []);`,
        fixLang: "jsx",
        frequency: 2,
        exposure: 3,
        confidence: 0.7,
        source: "mcp",
      }),
    );
  }

  for (const { route } of ctx.routes) {
    for (const device of ["mobile", "desktop"]) {
      const lighthouse = labFor(ctx, route, device);
      const anim = audit(lighthouse, "non-composited-animations");
      if (!anim || anim.score !== 0 || !anim.items?.length) continue;
      out.push(
        finding({
          id: "RUNTIME-NON-COMPOSITED-ANIMATION",
          title: `${anim.items.length} animation(s) run off the compositor on \`${route}\` (${device})`,
          severity: "low",
          category: "runtime",
          scope: "page",
          route,
          devices: device,
          metric: "Lighthouse non-composited-animations",
          currentValue: `${anim.items.length} animation(s)`,
          targetValue: "transform/opacity only",
          evidence: anim.items.slice(0, 5).map((i, n) => `${n + 1}. ${String(i.node || i.snippet || i.selector || "element").replace(/\s+/g, " ").slice(0, 140)}`).join("\n"),
          rootCause: "Animating layout or paint properties forces style, layout and paint every frame instead of a compositor-only update.",
          userImpact: "Janky animation and dropped frames, worst on low-end devices.",
          businessImpact: "Cheap to fix and immediately visible.",
          recommendation: "Animate `transform` and `opacity` only; promote with `will-change` sparingly.",
          expectedImprovement: "Animation moves to the compositor thread and stops competing with JS.",
          effort: "low",
          fixSnippet: `/* Before */ .card:hover { top: -4px; }
/* After  */ .card:hover { transform: translateY(-4px); }`,
          fixLang: "css",
          frequency: 2,
          exposure: device === "mobile" ? 4 : 2,
          confidence: 0.85,
          source: "psi-lab",
        }),
      );
    }
  }

  return dedupe(out);
}

function dominantPhase(p) {
  const phases = [
    ["input delay", Number(p.inputDelay) || 0],
    ["event processing", Number(p.processingDuration) || 0],
    ["presentation (render + paint)", Number(p.presentationDelay) || 0],
  ].sort((a, b) => b[1] - a[1]);
  if (!phases[0][1]) return "Phase breakdown was not captured; re-record the interaction with attribution enabled.";
  return `The dominant phase is ${phases[0][0]} at ${Math.round(phases[0][1])}ms.`;
}

function ms(v) {
  return v == null ? "—" : `${Math.round(Number(v))}ms`;
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.id}|${f.route}|${f.devices}|${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
