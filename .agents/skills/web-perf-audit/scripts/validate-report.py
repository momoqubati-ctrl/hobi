#!/usr/bin/env python3
"""Validate the structure of a Web Performance & RUM Audit report (and its plan).

Usage:
  validate-report.py <PERFORMANCE_AUDIT.md> [--plan <PERFORMANCE_PLAN.md>]
  validate-report.py --self-test    Validate built-in samples (CI smoke test).

The validator checks structure and measurement discipline, not prose quality:
required sections in order, no unresolved template tokens, a performance score in
the summary, findings that carry a severity, and — the rule this skill exists for
— that "not measured" is never rendered as a pass.
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

AUDIT_TITLE = r"^#\s+.*Performance.*Audit"
PLAN_TITLE = r"^#\s+.*Performance Implementation Plan"

AUDIT_HEADINGS = [
    "## Executive Summary",
    "## Performance Scorecard",
    "## RUM Results",
    "## Findings",
    "## Prioritization",
    "## Verification",
    "## Appendix / Methodology",
]

PLAN_HEADINGS = [
    "## Overview",
    "## Phase 1 — Critical",
    "## Phase 2 — Core Web Vitals",
    "## Phase 3 — Network & APIs",
    "## Phase 4 — JavaScript & Rendering",
    "## Phase 5 — Assets",
    "## Phase 6 — RUM & Regression Monitoring",
    "## Verification",
]

# Distinctive template tokens that must not survive into a finished document.
PLACEHOLDER_PATTERNS = [r"\{\{", r"Replace every placeholder"]

UNMEASURED = re.compile(r"not measured|not available|^—$|^$", re.IGNORECASE)
PASS_WORDS = re.compile(r"✅|\bgood\b|\bpass\b", re.IGNORECASE)


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _pass_without_measurement(section: str) -> list[str]:
    """Flag a metric row whose measured percentile is absent but whose status says pass.

    Only applied to tables that actually carry a p75 column — that is where the
    audit states a verdict, and where a fabricated pass would do damage.
    """
    errors: list[str] = []
    p75_index: int | None = None
    status_index: int | None = None
    for line in section.splitlines():
        if not line.strip().startswith("|"):
            p75_index = status_index = None
            continue
        cells = _cells(line)
        header = [c.lower() for c in cells]
        if "p75" in header and "status" in header:
            p75_index = header.index("p75")
            status_index = header.index("status")
            continue
        if p75_index is None or status_index is None:
            continue
        if len(cells) <= max(p75_index, status_index):
            continue
        measured = cells[p75_index].replace("*", "").strip()
        status = cells[status_index]
        if UNMEASURED.search(measured) and PASS_WORDS.search(status):
            errors.append(
                f'A metric with no p75 measurement is marked "{status}" — "not measured" is never a pass.'
            )
    return errors


def validate_audit(text: str) -> list[str]:
    errors: list[str] = []

    if not re.search(AUDIT_TITLE, text, flags=re.MULTILINE | re.IGNORECASE):
        errors.append('Missing H1 title matching "# … Performance … Audit".')

    errors.extend(_headings_in_order(text, AUDIT_HEADINGS))
    errors.extend(_no_placeholders(text))

    if not re.search(r"Performance score", text, flags=re.IGNORECASE):
        errors.append("Executive summary is missing a performance score.")

    findings = _section(text, "## Findings")
    if findings is not None:
        blocks = re.findall(r"^####\s+PERF-\d{3}\s+·\s+`[^`]+`", findings, flags=re.MULTILINE)
        if not blocks and "_No " not in findings:
            errors.append("Findings section has no `#### PERF-NNN · `CHECK-ID`` blocks.")
        severities = findings.count("| **Severity** |")
        if blocks and severities < len(blocks):
            errors.append(
                f"{len(blocks)} finding block(s) but only {severities} severity row(s) — every finding needs one."
            )

    rum = _section(text, "## RUM Results")
    if rum:
        errors.extend(f"RUM Results: {e}" for e in _pass_without_measurement(rum))

    if "not measured" not in text.lower() and "not available" not in text.lower():
        errors.append(
            'No "not measured" / "not available" labelling found — confirm unmeasured items are labelled, not silently omitted.'
        )

    return errors


def validate_plan(text: str) -> list[str]:
    errors: list[str] = []
    if not re.search(PLAN_TITLE, text, flags=re.MULTILINE | re.IGNORECASE):
        errors.append('Missing H1 title matching "# Performance Implementation Plan".')
    errors.extend(_headings_in_order(text, PLAN_HEADINGS))
    errors.extend(_no_placeholders(text))
    if not re.search(r"PERF-\d{3}|_No tasks in this phase\._", text):
        errors.append("Plan references no audit issue IDs (PERF-NNN).")
    return errors


def _headings_in_order(text: str, headings: list[str]) -> list[str]:
    errors: list[str] = []
    positions: list[int] = []
    for heading in headings:
        index = text.find(heading)
        if index < 0:
            errors.append(f"Missing required heading: {heading}")
        else:
            positions.append(index)
    if positions and positions != sorted(positions):
        errors.append("Required headings are not in the expected order.")
    return errors


def _no_placeholders(text: str) -> list[str]:
    return [
        f"Unresolved template content matches: {pattern}"
        for pattern in PLACEHOLDER_PATTERNS
        if re.search(pattern, text, flags=re.IGNORECASE)
    ]


def _section(text: str, heading: str) -> str | None:
    index = text.find(heading)
    if index < 0:
        return None
    rest = text[index + len(heading):]
    nxt = re.search(r"^##\s", rest, flags=re.MULTILINE)
    end = index + len(heading) + (nxt.start() if nxt else len(rest))
    return text[index:end]


def fail(messages: list[str]) -> int:
    for message in messages:
        print(f"ERROR: {message}", file=sys.stderr)
    return 1


SAMPLE_AUDIT = """# Web Performance & RUM Audit — https://example.com

| | |
|---|---|
| **Target** | https://example.com |
| **Date** | 2026-01-01 |

## Executive Summary

- **Performance score:** 64/100 (C — Needs work)
- **Findings:** 0 Critical · 2 High · 1 Medium · 0 Low · 1 Info
- **Priority:** 1 P0 · 1 P1 · 1 P2 · 0 P3

Real-user performance is workable but has clear, measurable gaps.

## Performance Scorecard

| Area | Status | Severity | Findings |
|---|---|---|---|
| LCP | Poor | High | 1 |
| INP | Not measured | — | — |

## RUM Results

| Metric | p50 | p75 | p95 | Target | Status |
|---|---:|---:|---:|---:|---|
| LCP | 2100ms _approx_ | **3800ms** | not available | ≤ 2500ms | ⚠️ Needs improvement |

## Findings

### `/`

#### PERF-001 · `CWV-LCP-P75` — LCP p75 is needs-improvement on mobile

| | |
|---|---|
| **Severity** | \U0001f7e0 High |
| **Priority** | P0 |

**Evidence**

```text
CrUX field (url-level) — LCP p75 = 3800ms (target ≤ 2500ms).
```

**Recommended fix:** Preload the LCP image and drop lazy loading.

---

## Prioritization

| # | Priority | Severity | Area | Scope | Finding | Effort |
|---|---|---|---|---|---|---|
| PERF-001 | P0 | High | LCP | `/` | LCP p75 is needs-improvement on mobile | Low |

## Verification

| Step | Command / method | Closes on |
|---|---|---|
| Lab re-run | `node scripts/psi.mjs --url https://example.com` | The source audit stops firing |

## Appendix / Methodology

- **What was measured:** field — 4 CrUX records; lab — 2 Lighthouse runs; runtime — not measured.
- **Not measured items** are reported as `Info`. They are not passes.
"""

SAMPLE_PLAN = """# Performance Implementation Plan — https://example.com

## Overview

| Phase | Focus | Tasks |
|---|---|---|
| 1 | Critical production issues | 1 |

## Phase 1 — Critical

| # | Issue | Task | Affected | Files / components | Expected impact | Risk | Complexity | Verification |
|---|---|---|---|---|---|---|---|---|
| PERF-001 | `CWV-LCP-P75` | Preload the LCP image | `/` (mobile) | route `/` | −600ms LCP | Low | Low | Field LCP p75 improves |

## Phase 2 — Core Web Vitals

_No tasks in this phase._

## Phase 3 — Network & APIs

_No tasks in this phase._

## Phase 4 — JavaScript & Rendering

_No tasks in this phase._

## Phase 5 — Assets

_No tasks in this phase._

## Phase 6 — RUM & Regression Monitoring

_No tasks in this phase._

## Verification

```text
Before / After / Improvement %
```
"""


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2

    if args[0] == "--self-test":
        errors: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            audit = Path(tmp) / "audit.md"
            plan = Path(tmp) / "plan.md"
            audit.write_text(SAMPLE_AUDIT, encoding="utf-8")
            plan.write_text(SAMPLE_PLAN, encoding="utf-8")
            errors += validate_audit(audit.read_text(encoding="utf-8"))
            errors += validate_plan(plan.read_text(encoding="utf-8"))

            # Negative case: a metric with no p75 measurement marked as a pass.
            bad = SAMPLE_AUDIT.replace(
                "| LCP | 2100ms _approx_ | **3800ms** | not available | ≤ 2500ms | ⚠️ Needs improvement |",
                "| LCP | 2100ms _approx_ | not measured | not available | ≤ 2500ms | ✅ Good |",
            )
            if not validate_audit(bad):
                errors.append("self-test: validator failed to reject a pass on an unmeasured value.")

        if errors:
            return fail(["self-test failed:"] + errors)
        print("Self-test passed: built-in audit and plan samples are valid, and the pass-without-measurement rule fires.")
        return 0

    audit_path = Path(args[0])
    if not audit_path.is_file():
        return fail([f"Report not found: {audit_path}"])

    errors = validate_audit(audit_path.read_text(encoding="utf-8"))

    if "--plan" in args:
        plan_index = args.index("--plan") + 1
        if plan_index >= len(args):
            return fail(["--plan needs a path"])
        plan_path = Path(args[plan_index])
        if not plan_path.is_file():
            errors.append(f"Plan not found: {plan_path}")
        else:
            errors += validate_plan(plan_path.read_text(encoding="utf-8"))

    if errors:
        return fail(errors)

    print(f"Structure is valid: {audit_path}" + (f" + {args[args.index('--plan') + 1]}" if "--plan" in args else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
