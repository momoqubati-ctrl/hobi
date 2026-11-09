#!/usr/bin/env bash
# Produce a structured diff of LOCAL changes for a pre-push review.
#
# Usage:
#   local-diff.sh                 Uncommitted changes (working tree + staged) vs HEAD  [default]
#   local-diff.sh --staged        Only staged changes (index vs HEAD)
#   local-diff.sh --unpushed      Commits not yet pushed (vs upstream, or detected base)
#   local-diff.sh --all-local     Everything not on the remote: unpushed commits + uncommitted edits
#
# Output is Markdown: scope, changed-file stats, the unified diff, and untracked files.
set -euo pipefail

mode="uncommitted"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --staged|--cached) mode="staged"; shift ;;
    --unpushed) mode="unpushed"; shift ;;
    --all-local|--all) mode="all-local"; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Error: unknown argument '$1'. Try --help." >&2; exit 1 ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script inside a Git repository." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Large-diff warning threshold (changed lines). Override with PR_REVIEW_LARGE_DIFF.
large_diff_threshold="${PR_REVIEW_LARGE_DIFF:-1500}"

emit_size_note() {
  # $1 = added+removed line count
  local total="$1"
  if [[ "$total" -gt "$large_diff_threshold" ]]; then
    printf -- '- **Note:** large diff (%s changed lines, threshold %s). Consider Deep mode or scoping the review to the highest-risk files.\n' \
      "$total" "$large_diff_threshold"
  fi
}

# Resolve a comparison base for unpushed / all-local modes:
# prefer the branch's upstream, then a common remote default.
resolve_base() {
  local base
  if base="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
    printf '%s' "$base"
    return 0
  fi
  for candidate in origin/HEAD origin/main origin/master main master; do
    if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

printf '# Pre-push review context\n\n'
printf -- '- Repository: `%s`\n' "$repo_root"
printf -- '- Branch: `%s`\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
printf -- '- Head SHA: `%s`\n' "$(git rev-parse HEAD 2>/dev/null || echo 'no commits yet')"
printf -- '- Diff scope: `%s`\n' "$mode"

# Determine the git diff spec for the selected mode.
diff_spec=()
case "$mode" in
  uncommitted) diff_spec=("HEAD") ;;
  staged)      diff_spec=("--staged") ;;
  unpushed)
    if ! base="$(resolve_base)"; then
      echo "Error: could not resolve an upstream/base ref for --unpushed. Set the branch upstream or pass changes another way." >&2
      exit 1
    fi
    printf -- '- Base ref: `%s`\n' "$base"
    diff_spec=("${base}...HEAD")
    ;;
  all-local)
    if ! base="$(resolve_base)"; then
      echo "Error: could not resolve an upstream/base ref for --all-local." >&2
      exit 1
    fi
    printf -- '- Base ref: `%s`\n' "$base"
    diff_spec=("$base")
    ;;
esac

# Aggregate line counts for the size note (tolerate the no-HEAD edge case).
total_changed="$(git diff --numstat "${diff_spec[@]}" 2>/dev/null | awk '{a+=$1; d+=$2} END {print a+d+0}')"
emit_size_note "$total_changed"

printf '\n## Changed files\n\n```text\n'
git diff --stat "${diff_spec[@]}" 2>/dev/null || true
printf '```\n\n## Diff\n\n```diff\n'
git diff --find-renames --find-copies --unified=80 "${diff_spec[@]}" 2>/dev/null || true
printf '```\n'

# Untracked (new) files only matter for working-tree scopes.
if [[ "$mode" == "uncommitted" || "$mode" == "all-local" ]]; then
  untracked_list="$(git ls-files --others --exclude-standard)"
  if [[ -n "$untracked_list" ]]; then
    printf '\n## Untracked files (new, not yet staged)\n\n```text\n%s\n```\n' "$untracked_list"
    printf '\n## Untracked file contents\n\n```diff\n'
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      git diff --no-index --unified=80 /dev/null "$f" 2>/dev/null || true
    done <<< "$untracked_list"
    printf '```\n'
  fi
fi
