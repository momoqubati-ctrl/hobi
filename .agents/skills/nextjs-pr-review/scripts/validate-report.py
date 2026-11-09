#!/usr/bin/env python3
"""Validate the required structure of a Next.js PR review Markdown report.

Usage:
  validate-report.py <report.md>   Validate a report file.
  validate-report.py --self-test   Validate a built-in sample (CI smoke test).
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

# The H1 title varies by skill (e.g. "Next.js PR Code Review", "Laravel PR Code Review").
TITLE_PATTERN = r"^#\s+.*PR Code Review\s*$"

REQUIRED_HEADINGS = [
    "## Executive Summary",
    "## Review Scope",
    "## Findings Overview",
    "## Security",
    "## Performance",
    "## Clean Code",
    "## Positive Observations",
    "## Open Questions",
    "## Validation Performed",
    "## Merge Recommendation",
    "## References",
]

PLACEHOLDER_PATTERNS = [
    r"<[^>]+>",
    r"Replace every placeholder",
    r"Repeat for each",
]

VERDICTS = ["Block", "Needs changes", "Approve with follow-ups", "Approve"]


def fail(messages: list[str]) -> int:
    for message in messages:
        print(f"ERROR: {message}", file=sys.stderr)
    return 1


def validate_text(text: str) -> list[str]:
    errors: list[str] = []

    if not re.search(TITLE_PATTERN, text, flags=re.MULTILINE):
        errors.append('Missing H1 title matching "# <name> PR Code Review".')

    positions: list[int] = []
    for heading in REQUIRED_HEADINGS:
        index = text.find(heading)
        if index < 0:
            errors.append(f"Missing required heading: {heading}")
        else:
            positions.append(index)

    if positions and positions != sorted(positions):
        errors.append("Required headings are not in the expected order.")

    for pattern in PLACEHOLDER_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            errors.append(f"Unresolved template content matches: {pattern}")

    verdict_pattern = r"\b(Block|Needs changes|Approve with follow-ups|Approve)\b"
    if not re.search(verdict_pattern, text):
        errors.append("No valid merge verdict found.")

    finding_heading_ids = re.findall(
        r"^###\s+`?((?:SEC|PERF|CLEAN)-\d{3})\b", text, flags=re.MULTILINE
    )
    if len(finding_heading_ids) != len(set(finding_heading_ids)):
        errors.append("Duplicate finding detail headings detected.")

    # Every detailed finding should carry severity and confidence labels.
    for fid in finding_heading_ids:
        section = _section_for(text, fid)
        if section is not None:
            if "**Severity:**" not in section:
                errors.append(f"{fid}: missing Severity field.")
            if "**Confidence:**" not in section:
                errors.append(f"{fid}: missing Confidence field.")

    return errors


def _section_for(text: str, fid: str) -> str | None:
    """Return the text of a finding's section, from its heading to the next ### or ##."""
    match = re.search(rf"^###\s+`?{re.escape(fid)}\b.*$", text, flags=re.MULTILINE)
    if not match:
        return None
    start = match.start()
    rest = text[match.end():]
    nxt = re.search(r"^##+\s", rest, flags=re.MULTILINE)
    end = match.end() + (nxt.start() if nxt else len(rest))
    return text[start:end]


SAMPLE_REPORT = """# Next.js PR Code Review

## Executive Summary

- PR / change: branch feature/x
- Purpose: Add a settings page.
- Verdict: Approve with follow-ups
- Risk level: Low
- Findings: 0 Critical, 0 High, 1 Medium, 0 Low

Reviewed scope is small and self-contained.

## Review Scope

- Repository: example
- Base: origin/main
- Head: feature/x
- Framework: Next.js 15, React 19, App Router

## Findings Overview

| ID | Category | Severity | Confidence | Location | Title |
|---|---|---|---|---|---|
| CLEAN-001 | Clean Code | Medium | High | app/settings/page.tsx:12 | Duplicated fetch |

## Security

No substantiated findings in the reviewed scope.

## Performance

No substantiated findings in the reviewed scope.

## Clean Code

### CLEAN-001 — Duplicated settings fetch

- **Severity:** Medium
- **Confidence:** High
- **Location:** app/settings/page.tsx:12
- **Evidence:** Same fetch is repeated in two siblings.
- **Why it matters:** Two places must change together.
- **Recommendation:** Extract a shared loader.
- **Verification:** Existing tests still pass.
- **Reference:** Refactoring, Fowler.

## Positive Observations

- Clear server/client boundaries.

## Open Questions

None.

## Validation Performed

| Command / check | Result | Notes |
|---|---|---|
| pnpm typecheck | Passed | clean |

## Merge Recommendation

**Approve with follow-ups**

Resolve CLEAN-001 in a follow-up.

## References

- Next.js docs — https://nextjs.org/docs
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2

    arg = sys.argv[1]

    if arg == "--self-test":
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=True) as tmp:
            tmp.write(SAMPLE_REPORT)
            tmp.flush()
            errors = validate_text(Path(tmp.name).read_text(encoding="utf-8"))
        if errors:
            return fail(["self-test failed:"] + errors)
        print("Self-test passed: built-in sample report is valid.")
        return 0

    path = Path(arg)
    if not path.is_file():
        return fail([f"Report not found: {path}"])

    errors = validate_text(path.read_text(encoding="utf-8"))
    if errors:
        return fail(errors)

    print(f"Report structure is valid: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
