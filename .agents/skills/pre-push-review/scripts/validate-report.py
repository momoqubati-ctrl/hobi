#!/usr/bin/env python3
"""Validate the required structure of a pre-push local review Markdown report.

Usage:
  validate-report.py <report.md>   Validate a report file.
  validate-report.py --self-test   Validate a built-in sample (CI smoke test).
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

TITLE_PATTERN = r"^#\s+.*Pre-Push.*Review\s*$"

REQUIRED_HEADINGS = [
    "## Executive Summary",
    "## Scorecard",
    "## Review Scope",
    "## Findings Overview",
    "## Security",
    "## Performance",
    "## Clean Code",
    "## Positive Observations",
    "## Open Questions",
    "## Validation Performed",
    "## Push Recommendation",
    "## References",
]

PLACEHOLDER_PATTERNS = [
    r"<[^>]+>",
    r"Replace every placeholder",
    r"Repeat for each",
]

VERDICTS = ["Do not push", "Fix before push", "Push with follow-ups", "Ready to push"]

# The Scorecard must rate each category with one of these levels.
SCORE_CATEGORIES = ["Security", "Performance", "Clean Code"]
SCORE_LEVELS = ("PASS", "WARN", "FAIL")


def fail(messages: list[str]) -> int:
    for message in messages:
        print(f"ERROR: {message}", file=sys.stderr)
    return 1


def validate_text(text: str) -> list[str]:
    errors: list[str] = []

    if not re.search(TITLE_PATTERN, text, flags=re.MULTILINE):
        errors.append('Missing H1 title matching "# <name> Pre-Push ... Review".')

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

    verdict_pattern = r"\b(Do not push|Fix before push|Push with follow-ups|Ready to push)\b"
    if not re.search(verdict_pattern, text):
        errors.append("No valid push recommendation found.")

    # The Scorecard section must rate each category PASS/WARN/FAIL.
    scorecard = _section_for_heading(text, "## Scorecard")
    if scorecard is not None:
        for category in SCORE_CATEGORIES:
            row = re.compile(
                rf"{re.escape(category)}.*\b(?:{'|'.join(SCORE_LEVELS)})\b"
            )
            if not row.search(scorecard):
                errors.append(
                    f"Scorecard missing a PASS/WARN/FAIL level for {category}."
                )

    finding_heading_ids = re.findall(
        r"^###\s+`?((?:SEC|PERF|CLEAN)-\d{3})\b", text, flags=re.MULTILINE
    )
    if len(finding_heading_ids) != len(set(finding_heading_ids)):
        errors.append("Duplicate finding detail headings detected.")

    # Every detailed finding should carry severity and confidence labels.
    for fid in finding_heading_ids:
        section = _section_for_finding(text, fid)
        if section is not None:
            if "**Severity:**" not in section:
                errors.append(f"{fid}: missing Severity field.")
            if "**Confidence:**" not in section:
                errors.append(f"{fid}: missing Confidence field.")

    return errors


def _section_for_heading(text: str, heading: str) -> str | None:
    """Return a ## section's text, from its heading to the next ## heading."""
    index = text.find(heading)
    if index < 0:
        return None
    rest = text[index + len(heading):]
    nxt = re.search(r"^##\s", rest, flags=re.MULTILINE)
    end = index + len(heading) + (nxt.start() if nxt else len(rest))
    return text[index:end]


def _section_for_finding(text: str, fid: str) -> str | None:
    """Return the text of a finding's section, from its heading to the next ### or ##."""
    match = re.search(rf"^###\s+`?{re.escape(fid)}\b.*$", text, flags=re.MULTILINE)
    if not match:
        return None
    start = match.start()
    rest = text[match.end():]
    nxt = re.search(r"^##+\s", rest, flags=re.MULTILINE)
    end = match.end() + (nxt.start() if nxt else len(rest))
    return text[start:end]


SAMPLE_REPORT = """# Pre-Push Local Review

## Executive Summary

- Diff scope: uncommitted (working tree + staged)
- Purpose: Add a settings page.
- Push recommendation: Push with follow-ups
- Risk level: Low
- Findings: 0 Critical, 0 High, 1 Medium, 0 Low

Reviewed scope is small and self-contained.

## Scorecard

| Category | Level | Findings (C/H/M/L) |
|---|---|---|
| Security | PASS | 0 / 0 / 0 / 0 |
| Performance | PASS | 0 / 0 / 0 / 0 |
| Clean Code | WARN | 0 / 0 / 1 / 0 |
| **Overall** | **WARN -> Push with follow-ups** | 0 / 0 / 1 / 0 |

## Review Scope

- Repository: example
- Diff scope: uncommitted (working tree + staged) vs HEAD
- Stack: JavaScript/TypeScript (Next.js)
- Changed files reviewed: 1

## Findings Overview

| ID | Category | Severity | Confidence | Location | Title |
|---|---|---|---|---|---|
| CLEAN-001 | Clean Code | Medium | High | app/settings/page.tsx:12 | Duplicated fetch |

## Security

No substantiated findings in the reviewed scope.

## Performance

No substantiated findings in the reviewed scope.

## Clean Code

### CLEAN-001 - Duplicated settings fetch

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
| npm run typecheck | Passed | clean |

## Push Recommendation

**Push with follow-ups**

Resolve CLEAN-001 in a follow-up before or shortly after pushing.

## References

- Refactoring, Martin Fowler.
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
