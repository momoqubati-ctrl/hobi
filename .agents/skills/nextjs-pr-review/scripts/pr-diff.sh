#!/usr/bin/env bash
# Produce a structured diff context for a Next.js PR review.
#
# Usage:
#   pr-diff.sh [base-ref]        Compare current HEAD against a base ref (auto-detected if omitted)
#   pr-diff.sh --pr <number>     Use GitHub CLI to fetch a specific PR's metadata and diff
#
# Output is Markdown: review context, changed-file stats, and the unified diff.
set -euo pipefail

base_ref=""
pr_number=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) pr_number="${2:-}"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) base_ref="$1"; shift ;;
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

printf '# PR review context\n\n'
printf -- '- Repository: `%s`\n' "$repo_root"
printf -- '- Head: `%s`\n' "$(git rev-parse --abbrev-ref HEAD)"
printf -- '- Head SHA: `%s`\n' "$(git rev-parse HEAD)"

# --- GitHub PR path (explicit number, or current branch's associated PR) ---
if command -v gh >/dev/null 2>&1; then
  if [[ -n "$pr_number" ]] || gh pr view --json number >/dev/null 2>&1; then
    pr_args=()
    [[ -n "$pr_number" ]] && pr_args=("$pr_number")

    if pr_json="$(gh pr view "${pr_args[@]}" --json number,title,url,baseRefName,headRefName,author,additions,deletions,changedFiles 2>/dev/null)"; then
      printf -- '- GitHub PR metadata: `%s`\n' "$pr_json"
      total="$(printf '%s' "$pr_json" | grep -oE '"(additions|deletions)":[0-9]+' | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')"
      emit_size_note "$total"
      printf '\n## Changed files\n\n```text\n'
      gh pr diff "${pr_args[@]}" --name-only
      printf '```\n\n## Diff\n\n```diff\n'
      gh pr diff "${pr_args[@]}"
      printf '```\n'
      exit 0
    fi
  fi
fi

if [[ -n "$pr_number" ]]; then
  echo "Error: --pr requires an authenticated GitHub CLI (gh). Run 'gh auth login'." >&2
  exit 1
fi

# --- Git merge-base path ---
if [[ -z "$base_ref" ]]; then
  for candidate in origin/main origin/master main master; do
    if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
      base_ref="$candidate"
      break
    fi
  done
fi

if [[ -z "$base_ref" ]]; then
  echo "Error: could not detect a base ref. Pass one, for example: pr-diff.sh origin/main" >&2
  exit 1
fi

merge_base="$(git merge-base "$base_ref" HEAD)"
printf -- '- Base ref: `%s`\n' "$base_ref"
printf -- '- Merge base: `%s`\n' "$merge_base"

# Aggregate line counts for the size note.
total_changed="$(git diff --numstat "$merge_base"...HEAD | awk '{a+=$1; d+=$2} END {print a+d+0}')"
emit_size_note "$total_changed"

printf '\n## Changed files\n\n```text\n'
git diff --stat "$merge_base"...HEAD
printf '```\n\n## Diff\n\n```diff\n'
git diff --find-renames --find-copies --unified=80 "$merge_base"...HEAD
printf '```\n'
