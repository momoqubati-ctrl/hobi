#!/usr/bin/env bash
# Detect the stack, the delivery target and the measurement tooling already in
# the project, so the audit knows which fixes are even applicable (next/image vs
# <picture>, next/font vs @font-face, Vercel vs nginx caching) and whether RUM
# already exists. Prints Markdown. Always exits 0.
#
# Usage: detect-stack.sh [project-root]
set -euo pipefail

root="${1:-$PWD}"
if git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
  root="$(git -C "$root" rev-parse --show-toplevel)"
fi
cd "$root"

# Match a real dependency entry ("name": "range"), not a keyword or a substring.
has() { grep -qE "\"$1\"[[:space:]]*:[[:space:]]*\"" package.json 2>/dev/null; }
line() { printf -- '- %s: `%s`\n' "$1" "$2"; }

printf '## Detected stack\n\n'
line "Root" "$root"

# --- framework + router ------------------------------------------------------
framework="unknown"
if [[ -f package.json ]]; then
  has 'next' && framework="Next.js"
  has 'nuxt' && framework="Nuxt"
  has '@remix-run/react' && framework="Remix"
  has 'astro' && framework="Astro"
  has '@sveltejs/kit' && framework="SvelteKit"
  has '@angular/core' && framework="Angular"
  if [[ "$framework" == "unknown" ]]; then
    has 'react' && framework="React (confirm SSR)"
    has 'vue' && framework="Vue (confirm SSR)"
  fi
fi
line "Framework" "$framework"

router=""
{ [[ -d app ]] || [[ -d src/app ]]; } && router="App Router"
{ [[ -d pages ]] || [[ -d src/pages ]]; } && router="${router:+$router + }Pages Router"
[[ -n "$router" ]] && line "Router" "$router"

# --- rendering surface -------------------------------------------------------
if [[ -f package.json ]] && has 'next'; then
  clients=$(grep -rlE "^['\"]use client['\"]" --include='*.tsx' --include='*.jsx' --include='*.ts' --include='*.js' app src pages components 2>/dev/null | wc -l | tr -d ' ')
  line "Client components (\"use client\")" "${clients:-0} file(s)"
fi

# --- asset pipeline ----------------------------------------------------------
img="raw <img>"
grep -rqE "from ['\"]next/image['\"]" --include='*.tsx' --include='*.jsx' . 2>/dev/null && img="next/image"
grep -rqE "<picture" --include='*.tsx' --include='*.jsx' --include='*.html' . 2>/dev/null && img="${img} + <picture>"
line "Images" "$img"

font="@font-face / <link>"
grep -rqE "from ['\"]next/font" --include='*.tsx' --include='*.ts' --include='*.jsx' --include='*.js' . 2>/dev/null && font="next/font (self-hosted)"
grep -rqE "fonts\.googleapis\.com" --include='*.tsx' --include='*.jsx' --include='*.html' --include='*.css' . 2>/dev/null && font="${font} + Google Fonts CDN"
line "Fonts" "$font"

# --- measurement already in place --------------------------------------------
printf -- '- RUM / monitoring:'
found=0
for pattern in web-vitals @vercel/speed-insights @sentry/nextjs @sentry/browser @datadog/browser-rum newrelic @vercel/analytics; do
  if has "$pattern"; then printf ' `%s`' "$pattern"; found=1; fi
done
grep -rqE "useReportWebVitals" --include='*.tsx' --include='*.jsx' . 2>/dev/null && { printf ' `useReportWebVitals`'; found=1; }
[[ "$found" -eq 0 ]] && printf ' none detected — field data will come from CrUX only'
printf '\n'

printf -- '- Perf tooling:'
toolfound=0
for pattern in @next/bundle-analyzer webpack-bundle-analyzer source-map-explorer size-limit @lhci/cli lighthouse; do
  if has "$pattern"; then printf ' `%s`' "$pattern"; toolfound=1; fi
done
[[ "$toolfound" -eq 0 ]] && printf ' none'
printf '\n'

# --- delivery / caching surface ---------------------------------------------
printf -- '- Delivery config:'
deliveryfound=0
for f in vercel.json netlify.toml next.config.js next.config.mjs next.config.ts nginx.conf Caddyfile wrangler.toml cloudfront.yaml; do
  [[ -f "$f" ]] && { printf ' `%s`' "$f"; deliveryfound=1; }
done
[[ "$deliveryfound" -eq 0 ]] && printf ' none found (caching is likely at the platform default)'
printf '\n'

# --- build output ------------------------------------------------------------
if [[ -d .next/static/chunks ]]; then
  size=$(du -sh .next/static/chunks 2>/dev/null | cut -f1)
  line "Build output" ".next/static/chunks present (${size:-unknown} uncompressed) — real chunk sizes available"
else
  line "Build output" "no build found — run a production build for real bundle sizes"
fi

printf '\nStatic detection reports *causes*, not measurements. Core Web Vitals, API latency and runtime behaviour need the URL mode of this skill (`--url`) plus a chrome-devtools MCP capture.\n'
