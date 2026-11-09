#!/usr/bin/env bash
# Detect the Next.js / React stack so the review applies version-correct guidance.
# Prints a short Markdown summary. Read source to confirm anything that affects findings.
#
# Usage: detect-stack.sh [project-root]
set -euo pipefail

root="${1:-$PWD}"
if git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
  root="$(git -C "$root" rev-parse --show-toplevel)"
fi
cd "$root"

# Read a top-level string field from package.json (dependencies/devDependencies).
dep_version() {
  local name="$1"
  [[ -f package.json ]] || return 0
  node -e '
    const fs=require("fs");
    try{
      const p=JSON.parse(fs.readFileSync("package.json","utf8"));
      const n=process.argv[1];
      const v=(p.dependencies&&p.dependencies[n])||(p.devDependencies&&p.devDependencies[n])||(p.peerDependencies&&p.peerDependencies[n]);
      if(v) process.stdout.write(v);
    }catch(e){}
  ' "$name" 2>/dev/null || true
}

pkg_field() {
  local field="$1"
  [[ -f package.json ]] || return 0
  node -e '
    const fs=require("fs");
    try{const p=JSON.parse(fs.readFileSync("package.json","utf8"));const v=p[process.argv[1]];if(v!=null)process.stdout.write(typeof v==="string"?v:JSON.stringify(v));}catch(e){}
  ' "$field" 2>/dev/null || true
}

printf '## Detected stack\n\n'
printf -- '- Root: `%s`\n' "$root"

if [[ ! -f package.json ]]; then
  printf -- '- No `package.json` found at this root. Confirm the project location.\n'
  exit 0
fi

next_v="$(dep_version next)"
react_v="$(dep_version react)"
ts_v="$(dep_version typescript)"

printf -- '- Next.js: `%s`\n' "${next_v:-not found}"
printf -- '- React: `%s`\n' "${react_v:-not found}"
printf -- '- TypeScript: `%s`\n' "${ts_v:-not found}"
printf -- '- Node engines: `%s`\n' "$(pkg_field engines || echo unspecified)"

# Package manager from lockfile.
pm="unknown"
if [[ -f pnpm-lock.yaml ]]; then pm="pnpm"
elif [[ -f yarn.lock ]]; then pm="yarn"
elif [[ -f bun.lockb || -f bun.lock ]]; then pm="bun"
elif [[ -f package-lock.json ]]; then pm="npm"
fi
printf -- '- Package manager (from lockfile): `%s`\n' "$pm"

# Router detection.
router=""
{ [[ -d app ]] || [[ -d src/app ]]; } && router="App Router"
if { [[ -d pages ]] || [[ -d src/pages ]]; }; then
  [[ -n "$router" ]] && router="$router + Pages Router" || router="Pages Router"
fi
printf -- '- Router: `%s`\n' "${router:-undetermined}"

# Middleware presence.
mw="none"
for f in middleware.ts middleware.js src/middleware.ts src/middleware.js; do
  [[ -f "$f" ]] && mw="$f" && break
done
printf -- '- Middleware: `%s`\n' "$mw"

# next.config flags worth knowing.
cfg=""
for f in next.config.js next.config.mjs next.config.ts next.config.cjs; do
  [[ -f "$f" ]] && cfg="$f" && break
done
if [[ -n "$cfg" ]]; then
  printf -- '- next.config: `%s`\n' "$cfg"
  flags=""
  grep -qE 'ppr\s*:' "$cfg" 2>/dev/null && flags="$flags ppr"
  grep -qE 'dynamicIO\s*:' "$cfg" 2>/dev/null && flags="$flags dynamicIO"
  grep -qE 'useCache\s*:' "$cfg" 2>/dev/null && flags="$flags useCache"
  grep -qE 'reactCompiler\s*:' "$cfg" 2>/dev/null && flags="$flags reactCompiler"
  grep -qE 'output\s*:' "$cfg" 2>/dev/null && flags="$flags output"
  [[ -n "$flags" ]] && printf -- '- next.config flags seen:%s\n' "$flags"
fi

# 'use cache' adoption (quick grep).
if grep -rqE "['\"]use cache['\"]" app src 2>/dev/null; then
  printf -- "- \`'use cache'\` directive: present in source\n"
fi

# Useful scripts.
printf -- '- Scripts: `%s`\n' "$(pkg_field scripts || echo none)"

printf '\nApply Next.js/React guidance for the versions above. In Next.js 15+, remember `fetch`/Route Handlers are uncached by default and request APIs (`cookies`/`headers`/`params`/`searchParams`) are async.\n'
