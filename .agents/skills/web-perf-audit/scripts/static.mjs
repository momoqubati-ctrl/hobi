// Codebase-mode static analysis.
//
// Reads source files to find the causes a live audit can only see the symptoms
// of: client-component spread, unsized images, externally hosted fonts, unmanaged
// third-party script tags, client-side data fetching, heavy dependencies, missing
// RUM instrumentation, and (when a build exists) real chunk sizes on disk.
//
// Static findings are labelled `static` and never claim a runtime measurement.

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".turbo", ".vercel", "vendor", "__snapshots__"]);
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".html", ".php", ".blade.php"]);
const MAX_FILES = 4000;

/** Dependencies whose full import is a known bundle-weight trap. */
const HEAVY_DEPS = {
  moment: "Use date-fns or the Intl API; moment ships every locale by default.",
  lodash: "Import from lodash-es per function, or use native equivalents.",
  "chart.js": "Load charting behind a dynamic import — it is rarely needed above the fold.",
  "@mui/icons-material": "Import icons individually or enable optimizePackageImports.",
  jquery: "Usually redundant alongside a component framework.",
  "aws-sdk": "Use modular @aws-sdk/client-* packages, and keep them server-only.",
  "core-js": "Only ship polyfills your browserslist target actually needs.",
};

/** Signals that first-party RUM already exists. Matched on import/init sites, not mentions. */
const RUM_SIGNALS = [
  { re: /(?:from|require\()\s*['"]web-vitals['"]/, name: "web-vitals" },
  { re: /useReportWebVitals\s*\(/, name: "next/web-vitals" },
  { re: /from\s*['"]@vercel\/speed-insights/, name: "Vercel Speed Insights" },
  { re: /from\s*['"]@sentry\/(?:nextjs|browser|react)['"]/, name: "Sentry" },
  { re: /datadogRum\s*\.\s*init\s*\(|from\s*['"]@datadog\/browser-rum['"]/, name: "Datadog RUM" },
  { re: /NREUM\s*=|newrelic\.js/, name: "New Relic Browser" },
  { re: /gtag\(\s*['"]config['"]/, name: "GA4" },
];

/** npm packages that, if installed, indicate a RUM stack is already wired. */
const RUM_PACKAGES = {
  "web-vitals": "web-vitals",
  "@vercel/speed-insights": "Vercel Speed Insights",
  "@sentry/nextjs": "Sentry",
  "@sentry/browser": "Sentry",
  "@sentry/react": "Sentry",
  "@datadog/browser-rum": "Datadog RUM",
  "newrelic": "New Relic Browser",
};

export async function analyzeCodebase(root) {
  const info = {
    root,
    framework: null,
    router: null,
    files: 0,
    useClient: [],
    unsizedImages: [],
    externalFonts: [],
    rawScriptTags: [],
    clientDataFetching: [],
    heavyDeps: [],
    rum: [],
    chunks: null,
    browserslist: null,
    nextConfig: null,
  };

  const pkgPath = path.join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = await readJson(pkgPath);
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    info.framework = deps.next ? "Next.js" : deps.nuxt ? "Nuxt" : deps.astro ? "Astro" : deps["@sveltejs/kit"] ? "SvelteKit" : deps["@remix-run/react"] ? "Remix" : deps.react ? "React" : deps.vue ? "Vue" : null;
    info.browserslist = pkg?.browserslist || null;
    for (const [dep, advice] of Object.entries(HEAVY_DEPS)) {
      if (deps[dep]) info.heavyDeps.push({ dep, version: deps[dep], advice });
    }
    for (const [dep, name] of Object.entries(RUM_PACKAGES)) {
      if (deps[dep] && !info.rum.includes(name)) info.rum.push(name);
    }
  }

  if (existsSync(path.join(root, "app")) || existsSync(path.join(root, "src/app"))) info.router = "App Router";
  if (existsSync(path.join(root, "pages")) || existsSync(path.join(root, "src/pages"))) {
    info.router = info.router ? `${info.router} + Pages Router` : "Pages Router";
  }

  for (const name of ["next.config.js", "next.config.mjs", "next.config.ts"]) {
    const p = path.join(root, name);
    if (existsSync(p)) {
      info.nextConfig = { file: name, text: (await readFile(p, "utf8")).slice(0, 4000) };
      break;
    }
  }

  const files = await walk(root);
  info.files = files.length;

  for (const file of files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, file);

    if (/^\s*['"]use client['"]/m.test(text)) {
      info.useClient.push({ file: rel, lines: text.split("\n").length });
    }
    for (const match of text.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      if (/\bwidth\b/i.test(tag) && /\bheight\b/i.test(tag)) continue;
      if (/aspect-ratio/i.test(tag)) continue;
      info.unsizedImages.push({ file: rel, snippet: squash(tag) });
    }
    for (const match of text.matchAll(/(?:href|src)=["'](https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net)[^"']*)["']/gi)) {
      info.externalFonts.push({ file: rel, url: match[1] });
    }
    for (const match of text.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi)) {
      const tag = match[0];
      if (/\b(defer|async)\b/i.test(tag)) continue;
      info.rawScriptTags.push({ file: rel, url: match[1], snippet: squash(tag) });
    }
    if (/useEffect\(\s*\(\)\s*=>\s*{[^}]*\bfetch\(/s.test(text)) {
      info.clientDataFetching.push({ file: rel });
    }
    for (const signal of RUM_SIGNALS) {
      if (signal.re.test(text) && !info.rum.includes(signal.name)) info.rum.push(signal.name);
    }
  }

  info.chunks = await readBuiltChunks(root);
  return info;
}

/** Real chunk sizes from a completed Next.js build, when one exists. */
async function readBuiltChunks(root) {
  const dir = path.join(root, ".next", "static", "chunks");
  if (!existsSync(dir)) return null;
  const entries = [];
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let names;
    try {
      names = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of names) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".js")) {
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        total += s.size;
        entries.push({ file: path.relative(root, full), bytes: s.size });
      }
    }
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes: total, count: entries.length, largest: entries.slice(0, 10), note: "Uncompressed on-disk sizes from .next/static/chunks — roughly 3–4x the gzip transfer size." };
}

async function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      const ext = entry.name.includes(".blade.php") ? ".blade.php" : path.extname(entry.name);
      if (SOURCE_EXT.has(ext)) files.push(full);
      if (files.length >= MAX_FILES) break;
    }
  }
  return files;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function squash(s) {
  return String(s).replace(/\s+/g, " ").trim().slice(0, 160);
}
