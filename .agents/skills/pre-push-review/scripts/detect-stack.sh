#!/usr/bin/env bash
# Detect the project's languages and tooling so the review applies the right lens.
# Stack-agnostic: prints a short Markdown summary. Read source to confirm anything
# that affects findings. Always exits 0.
#
# Usage: detect-stack.sh [project-root]
set -euo pipefail

root="${1:-$PWD}"
if git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
  root="$(git -C "$root" rev-parse --show-toplevel)"
fi
cd "$root"

printf '## Detected stack\n\n'
printf -- '- Root: `%s`\n' "$root"

# --- Languages by manifest ---
langs=""
add_lang() { case " $langs " in *" $1 "*) ;; *) langs="$langs $1" ;; esac; }

[[ -f package.json ]] && add_lang "JavaScript/TypeScript"
[[ -f composer.json ]] && add_lang "PHP"
{ [[ -f pyproject.toml ]] || [[ -f requirements.txt ]] || [[ -f setup.py ]] || [[ -f Pipfile ]]; } && add_lang "Python"
[[ -f go.mod ]] && add_lang "Go"
[[ -f Gemfile ]] && add_lang "Ruby"
[[ -f Cargo.toml ]] && add_lang "Rust"
{ [[ -f pom.xml ]] || [[ -f build.gradle ]] || [[ -f build.gradle.kts ]]; } && add_lang "Java/Kotlin"
[[ -f Package.swift ]] && add_lang "Swift"
[[ -f pubspec.yaml ]] && add_lang "Dart/Flutter"
find . -maxdepth 2 -name '*.csproj' 2>/dev/null | grep -q . && add_lang ".NET/C#"

langs="${langs# }"
printf -- '- Languages (by manifest): `%s`\n' "${langs:-none detected}"

# --- Lockfiles / package managers ---
locks=""
[[ -f pnpm-lock.yaml ]] && locks="$locks pnpm"
[[ -f yarn.lock ]] && locks="$locks yarn"
{ [[ -f bun.lockb ]] || [[ -f bun.lock ]]; } && locks="$locks bun"
[[ -f package-lock.json ]] && locks="$locks npm"
[[ -f composer.lock ]] && locks="$locks composer"
[[ -f poetry.lock ]] && locks="$locks poetry"
[[ -f Pipfile.lock ]] && locks="$locks pipenv"
[[ -f go.sum ]] && locks="$locks go-modules"
[[ -f Gemfile.lock ]] && locks="$locks bundler"
[[ -f Cargo.lock ]] && locks="$locks cargo"
locks="${locks# }"
printf -- '- Lockfiles: `%s`\n' "${locks:-none}"

# --- Lightweight framework hints (grep on manifests; no runtime needed) ---
hint() {
  # $1 = file, $2 = pattern, $3 = label
  grep -qE "$2" "$1" 2>/dev/null && printf -- '- Framework hint: `%s`\n' "$3"
  return 0
}
if [[ -f package.json ]]; then
  hint package.json '"next"' "Next.js"
  hint package.json '"react"' "React"
  hint package.json '"vue"' "Vue"
  hint package.json '"@angular/core"' "Angular"
  hint package.json '"svelte"' "Svelte"
  hint package.json '"express"' "Express"
  hint package.json '"@nestjs/core"' "NestJS"
fi
if [[ -f composer.json ]]; then
  hint composer.json 'laravel/framework' "Laravel"
  hint composer.json 'symfony/' "Symfony"
fi
if [[ -f requirements.txt || -f pyproject.toml ]]; then
  grep -qiE 'django' requirements.txt pyproject.toml 2>/dev/null && printf -- '- Framework hint: `Django`\n'
  grep -qiE 'flask' requirements.txt pyproject.toml 2>/dev/null && printf -- '- Framework hint: `Flask`\n'
  grep -qiE 'fastapi' requirements.txt pyproject.toml 2>/dev/null && printf -- '- Framework hint: `FastAPI`\n'
fi

# --- Test / lint command surfaces (so Phase 3 can run the repo's own checks) ---
runners=""
[[ -f package.json ]] && runners="$runners package.json:scripts"
[[ -f composer.json ]] && runners="$runners composer.json:scripts"
[[ -f Makefile ]] && runners="$runners Makefile"
[[ -f justfile || -f Justfile ]] && runners="$runners justfile"
[[ -f tox.ini ]] && runners="$runners tox"
[[ -f noxfile.py ]] && runners="$runners nox"
runners="${runners# }"
printf -- '- Command surfaces: `%s`\n' "${runners:-none obvious}"

# --- Repo guidance worth reading before reviewing ---
printf -- '- Guidance files:'
found_guidance=0
for f in AGENTS.md CLAUDE.md CONTRIBUTING.md README.md; do
  [[ -f "$f" ]] && { printf ' `%s`' "$f"; found_guidance=1; }
done
[[ "$found_guidance" -eq 0 ]] && printf ' none'
printf '\n'

printf '\nApply language- and framework-appropriate guidance for the stack above. When a manifest reveals a framework (e.g. Laravel, Next.js, Django), review with that framework'\''s conventions and version behavior in mind.\n'
